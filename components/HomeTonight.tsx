import Link from 'next/link';
import { query } from '@/lib/db';
import { getCurrentMember } from '@/lib/auth';
import { getRecommendedEvents } from '@/lib/recommend';
import { toRecCards } from '@/lib/recCards';
import { EventImage } from '@/components/EventImage';
import { fmtEventDate } from '@/lib/util';
import styles from './HomeTonight.module.css';

type HomeTonightEvent = {
  id: string;
  title: string;
  slug: string;
  start_at: string;
  end_at: string;
  timezone: string;
  city: string | null;
  primary_image_url: string | null;
  featured: boolean;
  venue_name: string | null;
  going_count: number;
  genres: { name: string; slug: string }[];
};

type HomePick = {
  id: string;
  title: string;
  slug: string;
  when: string;
  city: string | null;
  primary_image_url: string | null;
  genres: string[];
  featured?: boolean;
};

export async function HomeTonight() {
  const member = await getCurrentMember();
  const [events, recommended] = await Promise.all([
    query<HomeTonightEvent>(
      `select e.id, e.title, e.slug, e.start_at::text, e.end_at::text, e.timezone,
              e.city, e.primary_image_url, e.featured, v.name as venue_name,
              coalesce((select count(*)::int from member_event_actions mea
                         where mea.event_id = e.id and mea.rsvp = 'going'), 0) as going_count,
              coalesce((select json_agg(json_build_object('name', g.name, 'slug', g.slug))
                          from event_genres eg join genres g on g.id = eg.genre_id
                         where eg.event_id = e.id), '[]'::json) as genres
         from events e
         left join venues v on v.id = e.venue_id
        where e.status = 'live'
          and e.listing_status <> 'cancelled'
          and e.start_at > now()
          and e.start_at < now() + interval '18 hours'
        order by e.featured desc, e.start_at asc
        limit 8`
    ),
    member
      ? getRecommendedEvents(member.id, { limit: 3, exploration: false })
      : Promise.resolve([]),
  ]);

  if (!events.length) {
    return (
      <section className={styles.empty}>
        <div className="homeKicker">Tonight</div>
        <h2 className="homeSectionTitle">We’re watching what’s happening tonight.</h2>
        <p style={{ color: 'var(--text-muted)', marginBottom: 18 }}>
          Nothing live is close enough to show here yet — browse everything coming up instead.
        </p>
        <Link href="/events" className="btnGhost">Browse events →</Link>
      </section>
    );
  }

  const editorial = events.filter((e) => e.featured);
  const fallback = events.filter((e) => !e.featured);
  const publicPicks: HomePick[] = [...editorial, ...fallback].slice(0, 3).map((event) => ({
    id: event.id,
    title: event.title,
    slug: event.slug,
    when: fmtEventDate(event.start_at, event.end_at, event.timezone),
    city: event.city,
    primary_image_url: event.primary_image_url,
    genres: event.genres.map((g) => g.name),
    featured: event.featured,
  }));
  const personalisedPicks: HomePick[] = toRecCards(recommended).map((event) => ({
    id: event.id,
    title: event.title,
    slug: event.slug,
    when: event.when,
    city: event.city,
    primary_image_url: event.primary_image_url,
    genres: event.genres,
  }));
  const picks = member && personalisedPicks.length ? personalisedPicks : publicPicks;
  const tonight = events.slice(0, 5);
  const totalGoing = tonight.reduce((sum, event) => sum + event.going_count, 0);

  return (
    <section className={styles.section} aria-label="Tonight and Guestlist picks">
      <div className={styles.appPanel}>
        <div className={styles.appHead}>
          <div>
            <div className={styles.liveEyebrow}>LIVE NOW</div>
            <h2 className={styles.appTitle}>Who’s out tonight?</h2>
            <p className={styles.appSub}>
              {totalGoing > 0
                ? `${totalGoing} Guestlist ${totalGoing === 1 ? 'member is' : 'members are'} already going out`
                : 'See who’s heading out — and be the first one there.'}
            </p>
          </div>
          <div className={styles.appActions}>
            <Link href="/notifications" className={styles.pill}>♟ <span>Notifications</span></Link>
            <Link href="/you" className={`${styles.pill} ${styles.iconPill}`} aria-label="Tonight settings">⚙</Link>
          </div>
        </div>

        <div className={styles.listHead}>
          <span>TONIGHT</span>
          <Link href="/events" className={styles.allTonight}>See all →</Link>
        </div>

        <div className={styles.tonightList}>
          {tonight.map((event) => (
            <Link href={`/events/${event.slug}`} className={styles.eventRow} key={event.id}>
              <span className={styles.thumb}>
                <EventImage
                  src={event.primary_image_url}
                  genres={event.genres.map((g) => g.name)}
                  compactArt
                />
              </span>
              <span className={styles.eventBody}>
                <span className={styles.eventTitle}>{event.title}</span>
                <span className={styles.eventMeta}>
                  {fmtEventDate(event.start_at, event.end_at, event.timezone)}
                  {event.venue_name ? ` · ${event.venue_name}` : ''}
                  {event.city ? ` · ${event.city}` : ''}
                </span>
                <span className={event.going_count > 0 ? styles.socialActive : styles.socialMuted}>
                  {event.going_count > 0
                    ? `${event.going_count} ${event.going_count === 1 ? 'person' : 'people'} going`
                    : 'Be the first one there'}
                </span>
              </span>
              <span className={styles.rowArrow}>›</span>
            </Link>
          ))}
        </div>
      </div>

      <aside className={styles.picks}>
        <div className={styles.picksHead}>
          <div>
            <div className="homeKicker" style={{ marginBottom: 6 }}>Guestlist</div>
            <h2 className={styles.picksTitle}>Picks</h2>
          </div>
          <Link href="/events" className={styles.viewAll}>View all →</Link>
        </div>

        {picks.map((event, index) => (
          <Link href={`/events/${event.slug}`} className={styles.pick} key={event.id}>
            <span className={styles.pickThumb}>
              <EventImage
                src={event.primary_image_url}
                genres={event.genres}
                compactArt
              />
              <span className={styles.pickNumber}>{String(index + 1).padStart(2, '0')}</span>
            </span>
            <span>
              <span className={styles.pickName}>{event.title}</span>
              <span className={styles.pickMeta}>
                {event.when}
                {event.city ? ` · ${event.city}` : ''}
              </span>
              {event.featured && <span className={styles.editorial}>Guestlist pick</span>}
            </span>
          </Link>
        ))}
      </aside>
    </section>
  );
}
