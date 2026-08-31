import Link from 'next/link';
import { getCurrentMember } from '@/lib/auth';
import {
  browseEvents, getLiveCities, getTopLevelGenres,
  type BrowseParams, type BrowseTab,
} from '@/lib/events';
import { query } from '@/lib/db';
import { EventCard } from '@/components/EventCard';
import { FilterControls } from '@/components/FilterControls';
import { getRecommendedEvents, trackRecommendationImpressions, weekendWindow } from '@/lib/recommend';
import { toRecCards } from '@/lib/recCards';
import { PicksHero } from '@/components/PicksHero';
import { AskPanel } from '@/components/ask/AskPanel';

export const dynamic = 'force-dynamic';

const TABS: { key: BrowseTab; label: string }[] = [
  { key: 'for-you', label: 'For You' },
  { key: 'this-weekend', label: 'This Weekend' },
  { key: 'day-parties', label: 'Day Parties' },
  { key: 'nightlife', label: 'Nightlife' },
  { key: 'festivals', label: 'Festivals' },
  { key: 'travel', label: 'Worth Travelling For' },
];

const INLINE_GENRES = ['house', 'drum-and-bass', 'jungle', 'techno', 'garage', 'disco', 'trance', 'reggae-and-dub'];

function datePresetRange(preset: string | undefined): { from: Date | null; to: Date | null } {
  if (!preset) return { from: null, to: null };
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const plus = (base: Date, days: number) => {
    const d = new Date(base);
    d.setDate(d.getDate() + days);
    return d;
  };
  switch (preset) {
    case 'today': return { from: start, to: plus(start, 1) };
    case 'tomorrow': return { from: plus(start, 1), to: plus(start, 2) };
    case 'week': return { from: start, to: plus(start, 7) };
    case 'month': return { from: start, to: plus(start, 31) };
    default: return { from: null, to: null };
  }
}

type Search = { [key: string]: string | string[] | undefined };
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function EventsPage({ searchParams }: { searchParams: Promise<Search> }) {
  const sp = await searchParams;
  const member = await getCurrentMember();

  const tab = (TABS.some((t) => t.key === one(sp.tab)) ? one(sp.tab) : 'for-you') as BrowseTab;
  const genre = one(sp.genre) || null;
  const eventType = one(sp.type) || null;
  const city = one(sp.city) || null;
  const datePreset = one(sp.date) || undefined;
  const price = one(sp.price) || null;
  const sortRaw = one(sp.sort);
  const sort = (['recommended', 'soonest', 'popular', 'newest'].includes(sortRaw ?? '')
    ? sortRaw
    : 'recommended') as BrowseParams['sort'];
  const lat = one(sp.lat) ? Number(one(sp.lat)) : null;
  const lng = one(sp.lng) ? Number(one(sp.lng)) : null;
  const showAllGenres = one(sp.more) === '1';

  const { from, to } = datePresetRange(datePreset);

  const [events, genres, cities] = await Promise.all([
    browseEvents({
      tab,
      genreSlug: genre,
      eventType,
      city,
      dateFrom: from,
      dateTo: to,
      freeOnly: price === 'free',
      maxPrice: price && price !== 'free' ? Number(price) : null,
      lat: Number.isFinite(lat as number) ? lat : null,
      lng: Number.isFinite(lng as number) ? lng : null,
      radiusKm: lat != null && lng != null ? 80 : null,
      sort,
      member: member ? { id: member.id, home_country: member.home_country } : null,
    }),
    getTopLevelGenres(),
    getLiveCities(),
  ]);

  // All genres (with parents) for the genre filter select.
  const allGenres = await query<{ name: string; slug: string; parent_name: string | null }>(
    `select g.name, g.slug, pg.name as parent_name
       from genres g left join genres pg on pg.id = g.parent_genre_id
      where g.active order by coalesce(pg.sort_order, g.sort_order), g.parent_genre_id nulls first, g.sort_order`
  );

  // Personalised picks on the unfiltered For You / This Weekend tabs.
  const noFilters = !genre && !eventType && !city && !datePreset && !price;
  let picks: Awaited<ReturnType<typeof getRecommendedEvents>> = [];
  if (member && noFilters && (tab === 'for-you' || tab === 'this-weekend')) {
    const window = tab === 'this-weekend' ? weekendWindow() : { from: null, to: null };
    picks = await getRecommendedEvents(member.id, {
      limit: 8, from: window.from, to: window.to,
    });
    await trackRecommendationImpressions(member.id, picks, `events_${tab}`);
  }

  const savedIds = new Set<string>(
    member
      ? (
          await query<{ event_id: string }>(
            `select event_id from member_event_actions where member_id = $1 and saved_at is not null`,
            [member.id]
          )
        ).map((r) => r.event_id)
      : []
  );

  const buildQS = (overrides: Record<string, string | null>) => {
    const params = new URLSearchParams();
    const current: Record<string, string | null> = {
      tab: tab === 'for-you' ? null : tab,
      genre, type: eventType, city, date: datePreset ?? null, price,
      sort: sort === 'recommended' ? null : sort,
      more: showAllGenres ? '1' : null,
    };
    for (const [k, v] of Object.entries({ ...current, ...overrides })) {
      if (v) params.set(k, v);
    }
    const s = params.toString();
    return s ? `/events?${s}` : '/events';
  };

  const inlineGenres = genres.filter((g) => INLINE_GENRES.includes(g.slug));
  const moreGenres = genres.filter((g) => !INLINE_GENRES.includes(g.slug));
  const visibleGenres = showAllGenres ? [...inlineGenres, ...moreGenres] : inlineGenres;

  return (
    <main className="wrap">
      <h1 className="pageTitle">Events</h1>
      <p className="pageStandfirst">
        Nights, parties, festivals and experiences worth leaving the house for —
        curated for people who were raised on this music.
      </p>

      {picks.length > 0 && (
        <PicksHero
          title={tab === 'this-weekend' ? 'Your weekend, picked' : 'Picks for you'}
          surface={`events_${tab}`}
          events={toRecCards(picks)}
        />
      )}

      <AskPanel isSignedIn={!!member} />

      <nav className="tabRow" aria-label="Discovery">
        {TABS.map((t) => (
          <Link
            key={t.key}
            href={buildQS({ tab: t.key === 'for-you' ? null : t.key })}
            className={`tab${tab === t.key ? ' active' : ''}`}
          >
            {t.label}
          </Link>
        ))}
      </nav>

      <div className="chipRow" aria-label="Genres">
        <Link href={buildQS({ genre: null })} className={`chip${!genre ? ' active' : ''}`}>
          All
        </Link>
        {visibleGenres.map((g) => (
          <Link
            key={g.slug}
            href={buildQS({ genre: g.slug === genre ? null : g.slug })}
            className={`chip${genre === g.slug ? ' active' : ''}`}
          >
            {g.name}
          </Link>
        ))}
        {!showAllGenres && moreGenres.length > 0 && (
          <Link href={buildQS({ more: '1' })} className="chip">
            More +
          </Link>
        )}
      </div>

      <FilterControls
        cities={cities.map((c) => c.city)}
        genres={allGenres}
        current={{
          genre, type: eventType, city, date: datePreset ?? null, price, sort,
          nearMe: lat != null && lng != null,
        }}
      />

      <div className="resultMeta">
        {events.length === 0
          ? null
          : `${events.length} event${events.length === 1 ? '' : 's'}`}
      </div>

      {events.length > 0 ? (
        <div className="cardGrid">
          {events.map((e) => (
            <EventCard key={e.id} event={e} saved={savedIds.has(e.id)} isSignedIn={!!member} />
          ))}
        </div>
      ) : (
        <div className="emptyState">
          <h3>Nothing matching that yet.</h3>
          <p>The right night might be one filter away.</p>
          <div className="suggestions">
            {genre && (
              <Link href={buildQS({ genre: null })} className="btnGhost">Remove genre</Link>
            )}
            {(datePreset || tab === 'this-weekend') && (
              <Link href={buildQS({ date: null, tab: null })} className="btnGhost">Any date</Link>
            )}
            {city && (
              <Link href={buildQS({ city: null })} className="btnGhost">Anywhere</Link>
            )}
            {(eventType || price) && (
              <Link href={buildQS({ type: null, price: null })} className="btnGhost">Clear filters</Link>
            )}
            <Link href={buildQS({ tab: 'travel', genre: null, city: null, date: null })} className="btnGhost">
              Browse destinations
            </Link>
          </div>
          <div className="addPrompt">
            Know something we’re missing? <Link href="/events/submit">Add an event →</Link>
          </div>
        </div>
      )}
    </main>
  );
}
