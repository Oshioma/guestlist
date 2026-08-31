// THE ARCHIVE — browsing culture, not searching a database.

import Link from 'next/link';
import { getCurrentMember } from '@/lib/auth';
import { query } from '@/lib/db';
import { archiveHighlights, searchArchive } from '@/lib/archive/core';
import { ClubTrack } from '@/components/clubmessenger/ClubTrack';
import { MixCard, type MixRow } from '@/components/archive/MixCard';

export const dynamic = 'force-dynamic';

type Row = { id: string; title: string; slug: string; display_date: string; city: string | null; year: number | null };

export default async function ArchivePage({ searchParams }: { searchParams: Promise<{ q?: string; decade?: string }> }) {
  const sp = await searchParams;
  const member = await getCurrentMember();
  const q = sp.q?.trim() ?? '';
  const search = q ? await searchArchive(q, member?.id ?? null) : null;
  const hRaw = await archiveHighlights();
  const h = hRaw as unknown as {
    onThisWeek: Row[]; recent: Row[];
    flyers: { id: string; thumb_path: string | null; storage_path: string; slug: string; title: string; display_date: string }[];
    decades: { decade: number; n: number }[];
    entities: { id: string; name: string; slug: string; entity_type: string; city: string | null; country_name: string | null; active_from_year: number | null; active_to_year: number | null; members: number; archive_events: number }[];
    memories: { body: string; display_name: string; title: string; slug: string }[];
    mixes: MixRow[];
  };
  const searchTyped = search as unknown as {
    entities: { id: string; name: string; slug: string; city: string | null; active_from_year: number | null; active_to_year: number | null }[];
    events: (Row & { venue_name: string | null })[];
    flyers: unknown[];
  } | null;

  const decadeFilter = sp.decade ? Number(sp.decade) : null;
  const decadeRows = decadeFilter
    ? await query<Row>(
        `select id, title, slug, display_date, city, year from archive_events
          where status = 'published' and year >= $1 and year < $1 + 10
          order by year, title limit 40`,
        [decadeFilter]
      )
    : [];

  return (
    <main className="wrap archiveWrap">
      <ClubTrack type="archive_viewed" />
      <h1 className="pageTitle">The Archive</h1>
      <p className="pageStandfirst">
        The flyers, nights and rooms that made this culture — and the people
        who were actually there. Add yours, mark yourself in, find your scene.
      </p>

      <form className="archiveSearch" action="/archive" method="get">
        <input name="q" defaultValue={q} placeholder="Search a club, a night, a promoter, a DJ… (“The End”)" />
        <button className="btnAccent" type="submit">Search</button>
      </form>
      <div className="chipRow" style={{ margin: '10px 0 6px' }}>
        {h.decades.map((d) => (
          <Link key={d.decade} href={`/archive?decade=${d.decade}`}
                className={`chip${decadeFilter === d.decade ? ' active' : ''}`}>
            {`${d.decade}s (${d.n})`}
          </Link>
        ))}
        {member && <Link href="/archive/add" className="chip">+ Add to the archive</Link>}
      </div>

      {searchTyped && (
        <section className="youPanel">
          <div className="sectionLabel">{`Results for “${q}”`}</div>
          {searchTyped.entities.length === 0 && searchTyped.events.length === 0 && searchTyped.flyers.length === 0 && (
            <p className="youPanelSub">
              Nothing yet — but if you were there, you can put it on the map.{' '}
              <Link href="/archive/add" style={{ textDecoration: 'underline' }}>Add it →</Link>
            </p>
          )}
          {searchTyped.entities.length > 0 && (
            <>
              <div className="youHistoryMeta" style={{ margin: '8px 0 4px' }}>Places & scenes</div>
              <div className="chipRow">
                {searchTyped!.entities.map((e) => (
                  <Link key={e.id} href={`/archive/clubs/${e.slug}`} className="chip">
                    {e.name}{e.city && ` · ${e.city}`}
                    {e.active_from_year && ` · ${e.active_from_year}–${e.active_to_year ?? ''}`}
                  </Link>
                ))}
              </div>
            </>
          )}
          {searchTyped.events.length > 0 && (
            <>
              <div className="youHistoryMeta" style={{ margin: '10px 0 4px' }}>Nights</div>
              {searchTyped!.events.map((e) => (
                <div className="youHistoryRow" key={e.id}>
                  <Link href={`/archive/events/${e.slug}`}>
                    <strong>{e.title}</strong>
                    <span className="youHistoryMeta"> {e.display_date}{e.venue_name && ` · ${e.venue_name}`}{e.city && ` · ${e.city}`}</span>
                  </Link>
                </div>
              ))}
            </>
          )}
        </section>
      )}

      {decadeFilter && decadeRows.length > 0 && (
        <section>
          <div className="sectionLabel">{`The ${decadeFilter}s`}</div>
          {decadeRows.map((e) => (
            <div className="youHistoryRow" key={e.id}>
              <Link href={`/archive/events/${e.slug}`}>
                <strong>{e.title}</strong>
                <span className="youHistoryMeta"> {e.display_date}{e.city && ` · ${e.city}`}</span>
              </Link>
            </div>
          ))}
        </section>
      )}

      {h.flyers.length > 0 && (
        <section>
          <div className="sectionLabel">Flyers</div>
          <div className="flyerGrid">
            {h.flyers.map((f) => (
              <Link key={f.id} href={`/archive/flyers/${f.id}`} className="flyerCard">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={f.thumb_path ?? f.storage_path} alt={f.title} loading="lazy" />
                <span className="flyerCaption">{f.title} · {f.display_date}</span>
              </Link>
            ))}
          </div>
        </section>
      )}

      {h.mixes.length > 0 && (
        <section>
          <div className="sectionLabel">The mixes</div>
          <div className="mixGrid">
            {h.mixes.map((x) => <MixCard key={x.id} mix={x} canDelete={member?.role === 'admin'} />)}
          </div>
        </section>
      )}

      <div className="archiveTwoCol">
        {h.onThisWeek.length > 0 && (
          <section>
            <div className="sectionLabel">On this week in…</div>
            {h.onThisWeek.map((e) => (
              <div className="youHistoryRow" key={e.id}>
                <Link href={`/archive/events/${e.slug}`}>
                  <strong>{e.title}</strong>
                  <span className="youHistoryMeta"> {e.display_date}{e.city && ` · ${e.city}`}</span>
                </Link>
              </div>
            ))}
          </section>
        )}
        {h.recent.length > 0 && (
          <section>
            <div className="sectionLabel">Recently added</div>
            {h.recent.map((e) => (
              <div className="youHistoryRow" key={e.id}>
                <Link href={`/archive/events/${e.slug}`}>
                  <strong>{e.title}</strong>
                  <span className="youHistoryMeta"> {e.display_date}{e.city && ` · ${e.city}`}</span>
                </Link>
              </div>
            ))}
          </section>
        )}
      </div>

      {h.entities.length > 0 && (
        <section>
          <div className="sectionLabel">Clubs, promoters & scenes</div>
          <div className="exploreGrid">
            {h.entities.map((e) => (
              <Link key={e.id} href={`/archive/clubs/${e.slug}`} className="exploreCard">
                <span className="exploreName">{e.name}</span>
                <span className="exploreCountry">
                  {[e.city, e.country_name].filter(Boolean).join(', ')}
                  {e.active_from_year && ` · ${e.active_from_year}–${e.active_to_year ?? ''}`}
                </span>
                <span className="exploreStats">
                  {e.members > 0 && `${e.members} member${e.members === 1 ? '' : 's'} went here`}
                  {e.archive_events > 0 && `${e.members > 0 ? ' · ' : ''}${e.archive_events} night${e.archive_events === 1 ? '' : 's'} archived`}
                </span>
              </Link>
            ))}
          </div>
        </section>
      )}

      {h.memories.length > 0 && (
        <section className="dancedWith" style={{ marginTop: 24 }}>
          <div className="dancedTitle">People are remembering</div>
          {h.memories.map((m, i) => (
            <div className="memoryRow" key={i}>
              <div className="memoryBody">“{m.body}”</div>
              <div className="memoryMeta">
                {m.display_name} · <Link href={`/archive/events/${m.slug}`} style={{ textDecoration: 'underline' }}>{m.title}</Link>
              </div>
            </div>
          ))}
        </section>
      )}
    </main>
  );
}
