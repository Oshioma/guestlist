import Link from 'next/link';
import { getCurrentMember } from '@/lib/auth';
import { listPublishedArticles } from '@/lib/articles';
import { listLiveRetreats } from '@/lib/retreats';
import { RetreatShelf } from '@/components/RetreatShelf';
import styles from './balance.module.css';

export const dynamic='force-dynamic';
export const metadata={title:'Balance · Guestlist',description:'Ideas, experiences and perspectives from the Guestlist community.'};

export default async function BalancePage(){
  const [member,articles,retreats]=await Promise.all([getCurrentMember(),listPublishedArticles('balance',30),listLiveRetreats(12)]);
  return <main><section className={styles.hero}><div className="wrap"><div className={styles.topRow}><div><div className={styles.kicker}>Guestlist editorial</div><h1 className={styles.title}>Balance.</h1><p className={styles.lead}>Ideas, experiences and perspectives from the community — the culture around the night, not just the night itself.</p></div><Link className="btnAccent" href={member?'/balance/write':'/login?next=/balance/write'}>{member?'Write for Balance →':'Sign in to write →'}</Link></div></div></section><div className="wrap">
    {articles.length?<div className={styles.grid}>{articles.map((a,i)=><Link href={`/balance/${a.slug}`} className={`${styles.card} ${a.featured||i===0?styles.featured:''}`} key={a.id}>{a.hero_image_url&&<div className={styles.image}><img src={a.hero_image_url} alt={a.hero_image_alt||''}/></div>}<div className={styles.cardBody}><div className={styles.type}>{a.article_type.replace('-',' ')}</div><h2 className={styles.cardTitle}>{a.title}</h2>{a.excerpt&&<p style={{color:'var(--text-soft)',lineHeight:1.5,margin:'0'}}>{a.excerpt}</p>}<div className={styles.meta}>By {a.author_name} · {a.reading_minutes} min read</div></div></Link>)}</div>:<div className={styles.empty}>Balance is ready for its first story. Member submissions will appear here after editorial approval.</div>}
    <RetreatShelf retreats={retreats} />
    <section className={styles.writeStrip}><div><strong>Got something worth saying?</strong><div style={{color:'var(--text-muted)',marginTop:4}}>Write it in your own voice. We’ll help with the polish and image, then an editor reviews it before it goes live.</div></div><Link href={member?'/balance/write':'/login?next=/balance/write'} className="btnGhost">Start an article →</Link></section>
  </div></main>;
}
