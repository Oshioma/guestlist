// BALANCE DOES NOT ASK YOU TO WRITE.
//
// There were three buttons on the way down this page inviting a reader to
// contribute — one in the hero, one under the articles, one on the home page
// band. A page that asks for something three times before you have finished
// reading it is a page that wants something from you, and Balance is meant to
// be the calm half of the site.
//
// The invitation lives in the footer, on every page, once. Anyone who wants
// to write will find it; nobody has to be asked while they are reading.
import Link from 'next/link';
import { listPublishedArticles } from '@/lib/articles';
import { listLiveRetreats } from '@/lib/retreats';
import { RetreatShelf } from '@/components/RetreatShelf';
import styles from './balance.module.css';

export const dynamic='force-dynamic';
export const metadata={title:'Balance · Guestlist',description:'Ideas, experiences and perspectives from the Guestlist community.'};

export default async function BalancePage(){
  const [articles,retreats]=await Promise.all([listPublishedArticles('balance',30),listLiveRetreats(12)]);
  return <main><section className={styles.hero}><div className="wrap"><div className={styles.topRow}><div><div className={styles.kicker}>Guestlist editorial</div><h1 className={styles.title}>Balance.</h1><p className={styles.lead}>Ideas, experiences and perspectives from the community — the culture around the night, not just the night itself.</p></div></div></div></section><div className="wrap">
    {articles.length?<div className={styles.grid}>{articles.map((a,i)=><Link href={`/balance/${a.slug}`} className={`${styles.card} ${a.featured||i===0?styles.featured:''}`} key={a.id}>{a.hero_image_url&&<div className={styles.image}><img src={a.hero_image_url} alt={a.hero_image_alt||''}/></div>}<div className={styles.cardBody}><div className={styles.type}>{a.article_type.replace('-',' ')}</div><h2 className={styles.cardTitle}>{a.title}</h2>{a.excerpt&&<p style={{color:'var(--text-soft)',lineHeight:1.5,margin:'0'}}>{a.excerpt}</p>}<div className={styles.meta}>By {a.author_name} · {a.reading_minutes} min read</div></div></Link>)}</div>:<div className={styles.empty}>Balance is ready for its first story. Member submissions will appear here after editorial approval.</div>}
    <RetreatShelf retreats={retreats} />
  </div></main>;
}
