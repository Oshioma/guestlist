// askGuestlist — ONE channel-independent Ask engine. The website, the X
// inbox and any future channel all call this. Deterministic orchestration
// (no AI tool loop): parse → context → tools → rank → validate → answer.

import { query, queryOne } from '../db';
import { track } from '../analytics';
import { fmtEventDate, fmtEventTime, formatPrice } from '../util';
import { yourPeopleUpcoming } from '../scene';
import { parseAskQuestion, mergeIntent } from './intent';
import {
  archiveLookup, cityTimezone, memberAskContext, momentumNotes, pastToPresent,
  personalPicks, resolveDateWindow, searchEvents, socialOverlay, type AskEventRow,
} from './tools';
import { askThresholds, dataDensity } from './coldstart';
import { buildAllowlist, validateClaims } from './validate';
import { defaultAskWriter, TemplateAskWriter, type AskWriterClient } from './writer';
import type { AskAnswer, AskAnswerType, AskCard, AskIntent } from './types';

const MAX_QUESTION = 500;
const MAX_CARDS = 3;
// Rough claude-sonnet pricing for the cost ledger (USD per token).
const IN_TOKEN_USD = 3 / 1_000_000;
const OUT_TOKEN_USD = 15 / 1_000_000;

export type AskRequest = {
  question: string;
  viewerId: string | null;
  channel: 'website' | 'x';
  conversationId?: string | null;
  externalRef?: string | null;   // e.g. X conversation id
  ipHash?: string | null;        // guest rate limiting
  writer?: AskWriterClient;      // injectable for tests
};

function eventCard(
  e: AskEventRow,
  opts: {
    reasons: string[];
    social: AskCard['social'];
    momentumNote: string | null;
    src: string;
  }
): AskCard {
  return {
    type: 'event',
    id: e.id,
    title: e.title,
    slug: e.slug,
    when: `${fmtEventDate(e.start_at, e.end_at, e.timezone)} · ${fmtEventTime(e.start_at, e.end_at, e.timezone)}`,
    city: e.city,
    venueName: e.venue_name,
    price: formatPrice(e.price_from == null ? null : Number(e.price_from),
      e.price_to == null ? null : Number(e.price_to), e.currency),
    imageUrl: e.primary_image_url,
    genres: e.genres.slice(0, 3),
    reasons: opts.reasons.slice(0, 4),
    social: opts.social,
    momentumNote: opts.momentumNote,
    href: `/events/${e.slug}?src=${opts.src}`,
  };
}

// Constraint relaxation order — the smallest useful loosening first, and
// the blocked constraint is always NAMED, never silently dropped.
const RELAXATIONS: { key: keyof AskIntent; label: string; strip: (i: AskIntent) => AskIntent }[] = [
  { key: 'sizePref', label: 'smaller venues only', strip: (i) => ({ ...i, sizePref: null }) },
  { key: 'daytime', label: 'daytime', strip: (i) => ({ ...i, daytime: undefined }) },
  { key: 'afterHour', label: 'the late finish', strip: (i) => ({ ...i, afterHour: null }) },
  { key: 'lateNight', label: 'late-night starts', strip: (i) => ({ ...i, lateNight: undefined }) },
  { key: 'priceMax', label: 'the price cap', strip: (i) => ({ ...i, priceMax: null }) },
  { key: 'genres', label: 'that exact genre', strip: (i) => ({ ...i, genres: [] }) },
  { key: 'date', label: 'that exact date', strip: (i) => ({ ...i, date: { kind: 'window', days: 14 } }) },
];

async function relaxSearch(intent: AskIntent): Promise<{ label: string; rows: AskEventRow[] } | null> {
  for (const r of RELAXATIONS) {
    const val = intent[r.key];
    const isSet = Array.isArray(val) ? val.length > 0 : val != null && val !== false;
    if (!isSet) continue;
    const rows = await searchEvents(r.strip(intent), { limit: 6 });
    if (rows.length) return { label: r.label, rows };
  }
  return null;
}

export async function askGuestlist(req: AskRequest): Promise<AskAnswer> {
  const started = Date.now();
  const question = req.question.trim().slice(0, MAX_QUESTION);
  const writer = req.writer ?? defaultAskWriter();

  // Conversation: bounded structured state, never a transcript.
  let conversation = req.conversationId
    ? await queryOne<{ id: string; member_id: string | null; state: AskIntent }>(
        `select id, member_id, state from ask_conversations
          where id = $1 and (member_id is null or member_id = $2)`,
        [req.conversationId, req.viewerId])
    : req.externalRef
      ? await queryOne<{ id: string; member_id: string | null; state: AskIntent }>(
          `select id, member_id, state from ask_conversations where external_ref = $1`,
          [req.externalRef])
      : null;
  if (!conversation) {
    conversation = (await queryOne<{ id: string; member_id: string | null; state: AskIntent }>(
      `insert into ask_conversations (member_id, channel, external_ref)
       values ($1, $2, $3) returning id, member_id, '{}'::jsonb as state`,
      [req.viewerId, req.channel, req.externalRef ?? null]))!;
  }

  const parsed = await parseAskQuestion(question);
  const prev = conversation.state && Object.keys(conversation.state).length
    ? (conversation.state as AskIntent) : null;
  let intent = prev ? mergeIntent(prev, parsed, question) : parsed;

  // Member context: home city, travel, taste — never overriding privacy,
  // never available to guests.
  const memberCtx = req.viewerId ? await memberAskContext(req.viewerId) : null;
  if (!intent.city && memberCtx) {
    // "while I'm there" — an upcoming travel plan is the strongest context
    // when the question implies being away; otherwise home city.
    if (/there|trip|travel|away/.test(question.toLowerCase()) && memberCtx.travel[0]) {
      intent = { ...intent, city: memberCtx.travel[0].city, travelCity: memberCtx.travel[0].city };
    } else if (memberCtx.homeCity) {
      intent = { ...intent, city: memberCtx.homeCity };
    }
  }
  if (intent.travelCity && !intent.city) intent = { ...intent, city: intent.travelCity };

  // COLD START MODE — how much data exists around this query decides how
  // Ask ranks and how it talks (levels 5–7 of the signal hierarchy switch
  // on only when the numbers are real).
  const thresholds = await askThresholds();
  const density = await dataDensity(intent.city, req.viewerId, thresholds);

  const src = `ask-${conversation.id.slice(0, 8)}`;
  const needsCity = !intent.archive && !intent.pastToPresent && !intent.social
    && !intent.personalized && !intent.worthTravelling;

  let type: AskAnswerType = 'EVENT_RECOMMENDATIONS';
  let cards: AskCard[] = [];
  let relaxation: string | null = null;
  let clarification: string | null = null;
  let deterministicCommentary: string | null = null;
  let toolCalls = 0;

  if (needsCity && !intent.city) {
    type = 'CLARIFICATION';
    clarification = 'Which city?';
  } else if (intent.archive) {
    // ---- ARCHIVE DISCOVERY --------------------------------------------
    type = 'ARCHIVE_DISCOVERY';
    toolCalls++;
    const rows = await archiveLookup(
      { text: intent.archive.query, year: intent.archive.year }, req.viewerId);
    cards = rows.slice(0, 4).map((a) => ({
      type: 'archive' as const,
      id: a.id,
      title: a.title,
      slug: a.slug,
      when: `${a.display_date}${a.date_precision === 'circa' ? ' (approximate)' : ''}`,
      city: a.city,
      venueName: a.venue_name,
      price: null,
      imageUrl: null,
      genres: [],
      reasons: a.i_was_there > 0 ? [`${a.i_was_there} member${a.i_was_there === 1 ? ' was' : 's were'} there`] : [],
      social: null,
      momentumNote: null,
      href: `/archive/events/${a.slug}?src=${src}`,
    }));
    if (!cards.length) deterministicCommentary = 'The archive has nothing matching that yet — if you were there, you can put it on the map.';
  } else if (intent.pastToPresent && req.viewerId) {
    // ---- PAST → PRESENT ------------------------------------------------
    type = 'PAST_TO_PRESENT';
    toolCalls++;
    const picks = await pastToPresent(req.viewerId, { city: intent.city });
    cards = picks.map((p) => eventCard(p.event, {
      reasons: p.connections, social: null, momentumNote: null, src,
    }));
    if (!cards.length) deterministicCommentary =
      'Nothing upcoming connects clearly to the nights in your history yet — mark more I Was There nights and this gets sharper.';
  } else if (intent.pastToPresent) {
    type = 'DIRECT_ANSWER';
    deterministicCommentary = 'That one needs your history — join Guestlist and mark the nights you were at, and this question starts working.';
  } else if (intent.social) {
    // ---- SOCIAL DISCOVERY ---------------------------------------------
    type = 'SOCIAL_DISCOVERY';
    if (!req.viewerId) {
      deterministicCommentary = 'Your people live behind a profile — join Guestlist and connect with them to ask this.';
    } else {
      toolCalls++;
      const tz = await cityTimezone(intent.city);
      const { to } = resolveDateWindow(intent.date ?? { kind: 'weekend' }, tz);
      const plans = await yourPeopleUpcoming(req.viewerId, { to, limit: 30 });
      const wanted = intent.social === 'close_friends' ? plans.filter((p) => p.is_close) : plans;
      const byEvent = new Map<string, typeof plans>();
      for (const p of wanted) {
        const list = byEvent.get(p.event_id) ?? [];
        list.push(p);
        byEvent.set(p.event_id, list);
      }
      const eventIds = [...byEvent.keys()].slice(0, 6);
      if (eventIds.length) {
        toolCalls++;
        const rows = await query<AskEventRow>(
          `select e.id, e.title, e.slug, e.start_at::text, e.end_at::text, e.timezone, e.city,
                  v.name as venue_name, e.price_from::text, e.price_to::text, e.currency,
                  e.primary_image_url, e.event_type, e.listing_status,
                  0 as going_count,
                  coalesce((select array_agg(g.name) from event_genres eg
                              join genres g on g.id = eg.genre_id where eg.event_id = e.id), '{}') as genres
             from events e left join venues v on v.id = e.venue_id
            where e.id = any($1) and e.listing_status not in ('cancelled', 'postponed')`,
          [eventIds]);
        cards = rows
          .filter((e) => !intent.city || (e.city ?? '').toLowerCase() === intent.city.toLowerCase())
          .map((e) => {
            const ps = byEvent.get(e.id) ?? [];
            // Close-friend designation stays the viewer's own private mark:
            // stars only ever reflect THEIR stars, never anyone else's.
            const reasons = ps.slice(0, 3).map((p) => `${p.is_close ? '★ ' : ''}${p.display_name} is going`);
            return eventCard(e, { reasons, social: null, momentumNote: null, src });
          })
          .sort((a, b) => (b.reasons.some((r) => r.startsWith('★')) ? 1 : 0) - (a.reasons.some((r) => r.startsWith('★')) ? 1 : 0))
          .slice(0, MAX_CARDS);
      }
      if (!cards.length) deterministicCommentary =
        intent.social === 'close_friends'
          ? 'Nobody you’re close to has visible plans in that window yet.'
          : 'None of your people have visible plans in that window yet.';
    }
  } else if (intent.momentum) {
    // ---- MOMENTUM ------------------------------------------------------
    // Cold start: below the evidence floor, "heating up" does not exist as
    // a concept — Ask says so honestly and curates on relevance instead.
    type = 'EVENT_RECOMMENDATIONS';
    toolCalls += 2;
    const rows = await searchEvents({ ...intent, date: intent.date ?? { kind: 'tonight' } }, { limit: 15 });
    const notes = await momentumNotes(rows.map((r) => r.id), thresholds.momentum);
    const hot = rows.filter((r) => notes.has(r.id));
    if (hot.length) {
      cards = hot.slice(0, MAX_CARDS).map((e) => eventCard(e, {
        reasons: e.genres.slice(0, 2), social: null, momentumNote: notes.get(e.id) ?? null, src,
      }));
    } else {
      cards = rows.slice(0, MAX_CARDS).map((e) => eventCard(e, {
        reasons: e.genres.slice(0, 2), social: null, momentumNote: null, src,
      }));
      deterministicCommentary = density.mode === 'cold'
        ? `Too early to call anything "heating up" — not enough activity is flowing through Guestlist here yet. ${cards.length ? 'What fits, on merit:' : ''}`.trim()
        : 'Nothing is showing unusual movement right now — quiet so far.';
    }
  } else if (intent.worthTravelling) {
    // ---- WORTH TRAVELLING ----------------------------------------------
    type = 'EVENT_RECOMMENDATIONS';
    toolCalls++;
    const rows = await query<AskEventRow>(
      `select e.id, e.title, e.slug, e.start_at::text, e.end_at::text, e.timezone, e.city,
              v.name as venue_name, e.price_from::text, e.price_to::text, e.currency,
              e.primary_image_url, e.event_type, e.listing_status,
              (select count(*)::int from member_event_actions a
                where a.event_id = e.id and a.rsvp = 'going') as going_count,
              coalesce((select array_agg(g.name) from event_genres eg
                          join genres g on g.id = eg.genre_id where eg.event_id = e.id), '{}') as genres
         from events e left join venues v on v.id = e.venue_id
        where e.status = 'live' and e.listing_status not in ('cancelled', 'postponed')
          and e.worth_travelling and e.start_at between now() and now() + interval '45 days'
        order by e.start_at limit 8`);
    const memberGenres = new Set((memberCtx?.topGenres ?? []).map((g) => g.toLowerCase()));
    cards = rows
      .sort((a, b) =>
        b.genres.filter((g) => memberGenres.has(g.toLowerCase())).length
        - a.genres.filter((g) => memberGenres.has(g.toLowerCase())).length)
      .slice(0, MAX_CARDS)
      .map((e) => eventCard(e, {
        reasons: ['Worth travelling for',
          ...(e.genres.some((g) => memberGenres.has(g.toLowerCase())) ? ['Matches your taste'] : [])],
        social: null, momentumNote: null, src,
      }));
    if (!cards.length) deterministicCommentary = 'Nothing flagged worth the trip in the next month or so.';
  } else if (intent.personalized && req.viewerId) {
    // ---- SURPRISE ME ---------------------------------------------------
    type = 'EVENT_RECOMMENDATIONS';
    toolCalls++;
    const picks = await personalPicks(req.viewerId, { limit: MAX_CARDS });
    cards = picks.map((r) => eventCard({
      id: r.id, title: r.title, slug: r.slug, start_at: r.start_at, end_at: r.end_at,
      timezone: r.timezone, city: r.city, venue_name: r.venue_name,
      price_from: r.price_from == null ? null : String(r.price_from),
      price_to: r.price_to == null ? null : String(r.price_to),
      currency: r.currency, primary_image_url: r.primary_image_url,
      event_type: 'club_night', listing_status: 'confirmed', going_count: 0,
      genres: r.genres.map((g) => g.name).slice(0, 3),
    }, { reasons: r.reasonTexts, social: null, momentumNote: null, src }));
    if (!cards.length) deterministicCommentary = 'Not enough signal to surprise you yet — follow a few artists and mark some taste.';
  } else {
    // ---- THE MAIN EVENT SEARCH ----------------------------------------
    toolCalls++;
    let rows = await searchEvents(intent, { limit: 15 });
    if (!rows.length) {
      const relaxed = await relaxSearch(intent);
      if (relaxed) {
        type = 'NO_RESULTS';
        relaxation = `Nothing matches exactly — ${relaxed.label} is the limiting constraint. Loosening it gives ${relaxed.rows.length}${relaxed.rows.length === 1 ? ' option' : ' options'}, shown here.`;
        rows = relaxed.rows;
      } else {
        type = 'NO_RESULTS';
        deterministicCommentary = 'Nothing in Guestlist looks right for that yet — try another night or another city.';
      }
    }
    if (rows.length) {
      toolCalls += 2;
      const [social, notes] = await Promise.all([
        // Level 6 (social) only runs when the viewer actually has people.
        density.socialOn ? socialOverlay(req.viewerId, rows.map((r) => r.id))
          : Promise.resolve(new Map<string, never>()),
        momentumNotes(rows.map((r) => r.id), thresholds.momentum),
      ]);
      const memberGenres = new Set((memberCtx?.topGenres ?? []).map((g) => g.toLowerCase()));
      const scored = rows.map((e) => {
        const s = social.get(e.id);
        let score = 0;
        // Levels 1–4 always rank: query fit (SQL already filtered), taste,
        // travel context. Levels 5–7 (popularity, social, momentum) count
        // only past their density gates — early Guestlist is a curator,
        // not a popularity contest.
        if (e.genres.some((g) => memberGenres.has(g.toLowerCase()))) score += 12;
        if (intent.travelCity && (e.city ?? '').toLowerCase() === intent.travelCity.toLowerCase()) score += 5;
        if (s) score += s.close_friends_going * 30 + s.connections_going * 20
          + (s.scene_going >= thresholds.sceneGoing ? s.scene_going * 8 : 0);
        if (density.popularityOn) {
          if (notes.has(e.id)) score += 15;
          if (intent.sizePref === 'small') score -= Math.min(20, e.going_count / 10);
        } else if (intent.sizePref === 'small' && e.event_type === 'festival') {
          score -= 10; // size still respects hard facts, never sparse RSVPs
        }
        return { e, s, score };
      }).sort((a, b) => b.score - a.score);

      cards = scored.slice(0, MAX_CARDS).map(({ e, s }) => {
        const reasons: string[] = [...e.genres.slice(0, 2)];
        if (intent.sizePref === 'small' && e.event_type !== 'festival') reasons.push('Smaller room');
        // Social reasons only ever render with actual eligible people —
        // an empty "your people are going" module must not exist.
        if (s?.close_friends_going) reasons.push(`★ ${s.close_friends_going === 1 ? 'Someone you’re close to is' : `${s.close_friends_going} people you’re close to are`} going`);
        else if (s?.connections_going) reasons.push(`${s.connections_going} connection${s.connections_going === 1 ? '' : 's'} going`);
        else if (s && s.scene_going >= thresholds.sceneGoing) reasons.push('People from your scene are going');
        if (e.genres.some((g) => memberGenres.has(g.toLowerCase()))) reasons.push('Matches your taste');
        if (intent.travelCity) reasons.push('In a city you’re visiting');
        return eventCard(e, {
          reasons,
          social: s ? {
            connectionsGoing: s.connections_going,
            closeGoing: s.close_friends_going,
            names: s.close_friend_names.slice(0, 2),
          } : null,
          momentumNote: notes.get(e.id) ?? null,
          src,
        });
      });
    }
  }

  // ---- COMMENTARY: AI narrates, the validator decides -------------------
  const allow = buildAllowlist({
    names: [
      ...cards.flatMap((c) => [c.title, c.venueName, c.city, ...c.genres,
        ...(c.social?.names ?? []), ...c.reasons]),
      intent.city, 'Guestlist',
    ],
    numbers: [
      ...cards.flatMap((c) => [
        ...(`${c.when} ${c.price ?? ''} ${c.momentumNote ?? ''} ${c.reasons.join(' ')}`.match(/\d[\d,.:]*/g) ?? []),
        c.social?.connectionsGoing, c.social?.closeGoing,
      ]),
      cards.length, intent.archive?.year,
      ...(relaxation?.match(/\d+/g) ?? []),
    ],
  });

  let commentary = deterministicCommentary ?? clarification ?? '';
  let aiModel: string | null = null;
  let aiDraft: string | null = null;
  let validation: Record<string, unknown> | null = null;
  let inputTokens: number | null = null;
  let outputTokens: number | null = null;

  if (!deterministicCommentary && !clarification) {
    const result = await writer.write({ question, intent, cards, channel: req.channel, relaxation });
    if (result.ok) {
      aiDraft = result.commentary;
      const check = validateClaims(result.commentary, allow, {
        hasMomentumEvidence: cards.some((c) => c.momentumNote),
      });
      if (check.ok) {
        commentary = result.commentary;
        aiModel = result.model;
        inputTokens = result.inputTokens ?? null;
        outputTokens = result.outputTokens ?? null;
        validation = { ok: true };
      } else {
        // Unsupported claims never reach the user — deterministic fallback.
        const fallback = await new TemplateAskWriter().write({ question, intent, cards, channel: req.channel, relaxation });
        commentary = fallback.ok ? fallback.commentary : '';
        validation = { ok: false, problems: check.problems, fallback: 'template' };
      }
    } else {
      const fallback = await new TemplateAskWriter().write({ question, intent, cards, channel: req.channel, relaxation });
      commentary = fallback.ok ? fallback.commentary : '';
      validation = { ok: false, problems: [result.error], fallback: 'template' };
    }
  }

  // ---- FOLLOW-UP CHIPS --------------------------------------------------
  const followUps: string[] = [];
  if (type === 'EVENT_RECOMMENDATIONS' && cards.length) {
    if (intent.sizePref !== 'small') followUps.push('Anything smaller?');
    if (!intent.lateNight && !intent.afterHour) followUps.push('Later than midnight?');
    if (req.viewerId && !intent.social) followUps.push('Where are my people going?');
  }
  if (type === 'NO_RESULTS') followUps.push('This weekend instead?');
  if (req.viewerId && !intent.pastToPresent && type !== 'CLARIFICATION') followUps.push('Take me back — anything like my old nights?');
  if (!req.viewerId && type !== 'CLARIFICATION') followUps.push("What's heating up tonight?");

  // ---- PERSIST + ANALYTICS ---------------------------------------------
  // The density snapshot rides along for evaluation: every answer records
  // how much data it was standing on.
  const persistedIntent = {
    ...intent,
    cityAmbiguous: undefined,
    _density: {
      mode: density.mode, events: density.events, rsvpVolume: density.rsvpVolume,
      activeMembers: density.activeMembers, archiveCoverage: density.archiveCoverage,
      socialCoverage: density.socialCoverage,
    },
  };
  const message = (await queryOne<{ id: string }>(
    `insert into ask_messages
       (conversation_id, member_id, channel, ip_hash, question, intent, answer_type,
        result_event_ids, result_archive_ids, commentary, ai_model, ai_draft, validation,
        input_tokens, output_tokens, estimated_cost_usd, tool_calls, latency_ms)
     values ($1,$2,$3,$18,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
     returning id`,
    [conversation.id, req.viewerId, req.channel, question, JSON.stringify(persistedIntent), type,
     cards.filter((c) => c.type === 'event').map((c) => c.id),
     cards.filter((c) => c.type === 'archive').map((c) => c.id),
     commentary, aiModel, aiDraft, validation ? JSON.stringify(validation) : null,
     inputTokens, outputTokens,
     inputTokens != null || outputTokens != null
       ? (inputTokens ?? 0) * IN_TOKEN_USD + (outputTokens ?? 0) * OUT_TOKEN_USD : null,
     toolCalls, Date.now() - started, req.ipHash ?? null]))!;
  await query(
    `update ask_conversations set state = $2, updated_at = now() where id = $1`,
    [conversation.id, JSON.stringify(persistedIntent)]);
  await track('ask_question', {
    memberId: req.viewerId ?? undefined,
    metadata: {
      channel: req.channel, type, city: intent.city, genres: intent.genres,
      social: intent.social, results: cards.length, conversation_id: conversation.id,
    },
  });

  return {
    type,
    commentary,
    cards,
    followUps: followUps.slice(0, 3),
    clarification,
    relaxation,
    conversationId: conversation.id,
    messageId: message.id,
  };
}
