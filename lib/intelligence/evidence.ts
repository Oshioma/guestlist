// EVIDENCE PACKS — structured, versioned, grounded. Everything the AI is
// allowed to state as fact lives here; validation later rejects any number
// the pack cannot vouch for. Built fresh from the database, and rebuilt at
// publish time for revalidation.

import { query } from '../db';
import { heatForEvents, heatLabel } from '../heat';
import {
  type ArchiveEvidence, type EvidencePack, type EventEvidence, emptyEvidence,
} from './types';

const SITE = process.env.SITE_URL ?? 'https://www.guestlist.net';

function dateLabel(iso: string, timezone: string): string {
  return new Date(iso).toLocaleDateString('en-GB', {
    weekday: 'long', day: 'numeric', month: 'long', timeZone: timezone || 'UTC',
  });
}

function timeLabel(iso: string, timezone: string): string {
  return new Date(iso).toLocaleTimeString('en-GB', {
    hour: '2-digit', minute: '2-digit', timeZone: timezone || 'UTC',
  });
}

export async function buildEventEvidence(eventIds: string[]): Promise<EventEvidence[]> {
  if (!eventIds.length) return [];
  const [rows, heat] = await Promise.all([
    query<{
      id: string; title: string; slug: string; status: string; listing_status: string;
      start_at: string; end_at: string | null; timezone: string; venue: string | null;
      city: string | null; country: string | null; promoter: string | null;
      price_from: string | null; price_to: string | null; currency: string | null;
      ticket_url: string | null; artists: string[]; genres: string[];
    }>(
      `select e.id, e.title, e.slug, e.status, e.listing_status,
              e.start_at::text, e.end_at::text, e.timezone,
              v.name as venue, e.city, e.country, p.name as promoter,
              e.price_from::text, e.price_to::text, e.currency, e.ticket_url,
              coalesce((select array_agg(a.name order by ea.position)
                          from event_artists ea join artists a on a.id = ea.artist_id
                         where ea.event_id = e.id), '{}') as artists,
              coalesce((select array_agg(g.name) from event_genres eg
                          join genres g on g.id = eg.genre_id
                         where eg.event_id = e.id), '{}') as genres
         from events e
         left join venues v on v.id = e.venue_id
         left join promoters p on p.id = e.promoter_id
        where e.id = any($1)`,
      [eventIds]
    ),
    heatForEvents(eventIds),
  ]);
  return rows.map((r) => {
    const h = heat.get(r.id);
    return {
      id: r.id, title: r.title, slug: r.slug, url: `${SITE}/events/${r.slug}`,
      status: r.status, listing_status: r.listing_status,
      start_at: r.start_at, end_at: r.end_at, timezone: r.timezone,
      date_label: dateLabel(r.start_at, r.timezone),
      time_label: timeLabel(r.start_at, r.timezone),
      venue: r.venue, city: r.city, country: r.country,
      artists: r.artists, genres: r.genres, promoter: r.promoter,
      price_from: r.price_from, price_to: r.price_to, currency: r.currency,
      ticket_url: r.ticket_url,
      metrics: {
        views_24h: h?.signals.views24h ?? 0,
        ticket_clicks_24h: h?.signals.ticketClicks24h ?? 0,
        interested: h?.signals.interested ?? 0,
        going: h?.signals.going ?? 0,
        going_6h: h?.signals.goingLast6h ?? 0,
        saves: h?.signals.saves ?? 0,
        shares_24h: h?.signals.shares24h ?? 0,
        heat: h?.heat ?? 0,
        heat_label: heatLabel(h?.heat ?? 0),
      },
    };
  });
}

export async function buildArchiveEvidence(archiveEventIds: string[]): Promise<ArchiveEvidence[]> {
  if (!archiveEventIds.length) return [];
  const rows = await query<{
    id: string; title: string; slug: string; display_date: string; date_precision: string;
    year: number | null; venue: string | null; city: string | null; country: string | null;
    promoter: string | null; source_attribution: string | null;
    lineup: string[]; genres: string[]; iwt: number;
    media: { id: string; path: string; rights: string; hidden: boolean }[];
  }>(
    `select ae.id, ae.title, ae.slug, ae.display_date, ae.date_precision, ae.year,
            ae.venue_name as venue, ae.city, ae.country_name as country,
            ae.promoter_name as promoter, ae.source_attribution,
            coalesce((select array_agg(artist_name order by position)
                        from archive_event_artists where archive_event_id = ae.id), '{}') as lineup,
            coalesce((select array_agg(g.name) from archive_event_genres aeg
                        join genres g on g.id = aeg.genre_id
                       where aeg.archive_event_id = ae.id), '{}') as genres,
            -- PUBLIC I Was There marks only: privacy holds inside evidence too.
            (select count(*)::int from archive_attendance a
               join members am on am.id = a.member_id
              where a.archive_event_id = ae.id and a.visibility = 'public'
                and coalesce((select mp.profile_public from member_privacy mp
                               where mp.member_id = am.id), true)) as iwt,
            coalesce((select json_agg(json_build_object(
                        'id', m.id, 'path', coalesce(m.display_path, m.storage_path),
                        'rights', m.rights, 'hidden', m.hidden))
                        from archive_media m
                        join archive_items i on i.id = m.item_id and i.status = 'published'
                       where i.archive_event_id = ae.id), '[]'::json) as media
       from archive_events ae
      where ae.id = any($1) and ae.status = 'published'`,
    [archiveEventIds]
  );
  const thisYear = new Date().getUTCFullYear();
  return rows.map((r) => ({
    id: r.id, title: r.title, slug: r.slug, url: `${SITE}/archive/events/${r.slug}`,
    display_date: r.display_date, date_precision: r.date_precision, year: r.year,
    years_ago: r.year != null ? thisYear - r.year : null,
    venue: r.venue, city: r.city, country: r.country,
    lineup: r.lineup, genres: r.genres, promoter: r.promoter,
    i_was_there_public: r.iwt, source_attribution: r.source_attribution,
    media: r.media,
  }));
}

// Fact-locking allowlists: every number a draft uses must be here.
// Small list ordinals (0–12) are always allowed so "three worth looking at"
// style counting never trips validation; everything else must be evidenced.
function collectFactAllowlists(pack: EvidencePack): void {
  const numbers = new Set<string>();
  const names = new Set<string>();
  for (let i = 0; i <= 12; i++) numbers.add(String(i));
  const addNums = (s: string | null | undefined) => {
    for (const m of String(s ?? '').matchAll(/\d[\d,.]*/g)) {
      numbers.add(m[0].replace(/[,.]$/, ''));
      numbers.add(m[0].replace(/,/g, ''));
    }
  };
  const addName = (s: string | null | undefined) => { if (s) names.add(s); };
  for (const e of pack.events) {
    for (const v of [e.metrics.going, e.metrics.interested, e.metrics.saves,
      e.metrics.views_24h, e.metrics.ticket_clicks_24h, e.metrics.going_6h,
      e.metrics.shares_24h, e.metrics.heat]) numbers.add(String(v));
    addNums(e.date_label); addNums(e.time_label); addNums(e.title);
    addNums(e.price_from); addNums(e.price_to);
    addNums(e.start_at.slice(0, 10));
    numbers.add(e.start_at.slice(0, 4));
    addName(e.title); addName(e.venue); addName(e.city); addName(e.country);
    addName(e.promoter);
    e.artists.forEach(addName);
    e.genres.forEach(addName);
  }
  for (const a of pack.archive) {
    if (a.year != null) numbers.add(String(a.year));
    if (a.years_ago != null) numbers.add(String(a.years_ago));
    numbers.add(String(a.i_was_there_public));
    addNums(a.display_date); addNums(a.title);
    addName(a.title); addName(a.venue); addName(a.city); addName(a.country);
    addName(a.promoter);
    a.lineup.forEach(addName);
    a.genres.forEach(addName);
  }
  for (const v of Object.values(pack.aggregates)) {
    if (typeof v === 'number') numbers.add(String(v));
    else if (typeof v === 'string') addNums(v);
  }
  numbers.add(String(new Date().getUTCFullYear()));
  pack.numbers = [...numbers];
  pack.names = [...names];
}

export async function buildEvidencePack(input: {
  eventIds?: string[];
  archiveEventIds?: string[];
  aggregates?: Record<string, number | string | null>;
}): Promise<EvidencePack> {
  const pack = emptyEvidence();
  pack.events = await buildEventEvidence(input.eventIds ?? []);
  pack.archive = await buildArchiveEvidence(input.archiveEventIds ?? []);
  pack.aggregates = input.aggregates ?? {};
  collectFactAllowlists(pack);
  return pack;
}
