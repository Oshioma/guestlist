// The card grid every public list of writing uses — Balance, Event Features,
// a tag, a search. One component so the four never drift into four slightly
// different cards for the same piece.
//
// `lead` gives the first card the double-width treatment. Only the first
// page of a section gets it: on page three, or in search results, the first
// card is not the lead story, it is just the one that happened to sort first.
// `showSection` puts the section on the card where a list mixes them.

import Link from 'next/link';
import type { Article } from '@/lib/articles';
import styles from '@/app/balance/balance.module.css';

export function ArticleGrid({ articles, lead = false, showSection = false }: {
  articles: Article[]; lead?: boolean; showSection?: boolean;
}) {
  return (
    <div className={styles.grid}>
      {articles.map((a, i) => (
        <Link href={`/balance/${a.slug}`} key={a.id}
          className={`${styles.card} ${lead && (a.featured || i === 0) ? styles.featured : ''}`}>
          {a.hero_image_url && (
            <div className={styles.image}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={a.hero_image_url} alt={a.hero_image_alt || ''} loading={i > 2 ? 'lazy' : undefined} />
            </div>
          )}
          <div className={styles.cardBody}>
            <div className={styles.type}>
              {showSection ? `${a.section_name} · ` : ''}{a.article_type.replace('-', ' ')}
            </div>
            <h2 className={styles.cardTitle}>{a.title}</h2>
            {a.excerpt && <p style={{ color: 'var(--text-soft)', lineHeight: 1.5, margin: '0' }}>{a.excerpt}</p>}
            <div className={styles.meta}>By {a.author_name} · {a.reading_minutes} min read</div>
          </div>
        </Link>
      ))}
    </div>
  );
}

/**
 * Newer / Older, as plain links. Page 1 is the bare address (no ?page=1), so
 * the first page has one URL and not two; anything else on the address — a
 * search — is carried across, so paging through results stays in them.
 */
export function Pager({ basePath, page, hasNewer, hasOlder, query = {}, hash = '' }: {
  basePath: string; page: number; hasNewer: boolean; hasOlder: boolean;
  query?: Record<string, string | undefined>;
  // Where on the page the list is, when it is not the whole page.
  hash?: string;
}) {
  if (!hasNewer && !hasOlder) return null;
  const href = (p: number) => {
    const sp = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) if (v) sp.set(k, v);
    if (p > 1) sp.set('page', String(p));
    const s = sp.toString();
    return `${s ? `${basePath}?${s}` : basePath}${hash}`;
  };
  return (
    <nav className={styles.pager} aria-label="More writing">
      {hasNewer ? <Link href={href(page - 1)} rel="prev" className="btnGhost">← Newer</Link> : <span />}
      <span className={styles.pagerAt}>Page {page}</span>
      {hasOlder ? <Link href={href(page + 1)} rel="next" className="btnGhost">Older →</Link> : <span />}
    </nav>
  );
}

/** A path with ?page=N when N is past the first, for canonicals. */
export function pagedPath(basePath: string, page: number) {
  return page > 1 ? `${basePath}?page=${page}` : basePath;
}
