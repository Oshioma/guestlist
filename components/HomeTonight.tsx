import Link from 'next/link';
import { query } from '@/lib/db';
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
  genres: { name: string; slug: string }[];
};

export async function HomeTonight() {
  const events = await query<HomeTonightEvent>(
    `select e.id, e.title, e.slug, e.start_at::text, e.end_at::text, e.timezone,
            e.city, e.primary_image_url, e.featured, v.name as venue_name,
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
  );

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

  const hero = events[0];
  const editorial = events.filter((e) => e.featured && e.id !== hero.id);
  const fallback = events.filter((e) => !e.featured && e.id !== hero.id);
  const picks = [...editorial, ...fallback].slice(0, 3);
  const heroGenres = hero.genres.map((g) => g.name);

  return (
    <section className={styles.section} aria-label="Tonight and Guestlist picks">
      <article className={styles.tonight}>
        <div className={styles.media} aria-hidden="true">
          <EventImage src={hero.primary_image_url} genres={heroGenres} />
        </div>
        <div className={styles.scrim} aria-hidden="true" />
        <div className={styles.tonightInner}>
          <div className={styles.topline}>
            <span className={styles.badge}>TONIGHT</span>
            <span className={styles.place}>{hero.city ?? 'On Guestlist'}</span>
          </div>
          <div className={styles.copy}>
            <div className={styles.kicker}>What’s actually worth going to tonight?</div>
            <h2 className={styles.title}>{hero.title}</h2>
            <div className={styles.meta}>
              {fmtEventDate(hero.start_at, hero.end_at, hero.timezone)}
              {hero.venue_name ? ` · ${hero.venue_name}` : ''}
              {hero.city ? ` · ${hero.city}` : ''}
            </div>
            <div className={styles.actions}>
              <Link href={`/events/${hero.slug}`} className={styles.primary}>See tonight →</Link>
              <Link href="/events?tab=for-you" className={styles.secondary}>More tonight</Link>
            </div>
          </div>
        </div>
      </article>

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
            <span className={styles.number}>{String(index + 1).padStart(2, '0')}</span>
            <span>
              <span className={styles.pickName}>{event.title}</span>
              <span className={styles.pickMeta}>
                {fmtEventDate(event.start_at, event.end_at, event.timezone)}
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
