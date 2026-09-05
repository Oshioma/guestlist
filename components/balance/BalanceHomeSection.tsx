// The band shows what has been written. Asking for more belongs in the
// footer, where it sits once on every page — not under the reading.
import Link from 'next/link';
import { listPublishedArticles } from '@/lib/articles';
import { optional } from '@/lib/resilient';

function ArticleRow({articles}:{articles:Awaited<ReturnType<typeof listPublishedArticles>>}){
  if(!articles.length)return null;
  return <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(260px,320px))',gap:16,alignItems:'start'}}>
    {articles.map(a=><Link href={`/balance/${a.slug}`} key={a.id} style={{display:'block',border:'1px solid var(--border)',borderRadius:'var(--radius)',overflow:'hidden',background:'var(--bg-raised)',textDecoration:'none'}}>
      {a.hero_image_url&&<div style={{width:'100%',height:180,overflow:'hidden',background:'var(--bg-soft)'}}><img src={a.hero_image_url} alt={a.hero_image_alt||''} style={{display:'block',width:'100%',height:'100%',objectFit:'cover'}}/></div>}
      <div style={{padding:14}}><div style={{fontSize:11,textTransform:'uppercase',letterSpacing:'.1em',color:'var(--accent-ink)',fontWeight:800}}>{a.article_type.replace('-',' ')}</div><h3 style={{fontSize:20,lineHeight:1.08,margin:'6px 0'}}>{a.title}</h3><div style={{fontSize:12,color:'var(--text-muted)'}}>By {a.author_name} · {a.reading_minutes} min</div></div>
    </Link>)}
  </div>;
}

export async function BalanceHomeSection(){
  // Editorial is a band under the events, so a missing articles table takes
  // the band away, not the homepage.
  const [balance,eventFeatures]=await optional('BalanceHomeSection',
    ()=>Promise.all([listPublishedArticles('balance',3),listPublishedArticles('events',3)]),
    [[],[]] as [Awaited<ReturnType<typeof listPublishedArticles>>,Awaited<ReturnType<typeof listPublishedArticles>>]);
  return <section style={{padding:'34px 0',borderTop:'1px solid var(--border)',marginTop:32}}>
    <div className="homeSectionHead" style={{marginTop:0}}><div><div className="homeKicker">Community editorial</div><h2 className="homeSectionTitle" style={{marginTop:5}}>Balance</h2></div><Link href="/balance" className="btnGhost">Explore Balance →</Link></div>
    {balance.length?<ArticleRow articles={balance}/>:<p style={{color:'var(--text-muted)'}}>Member stories are coming to Balance.</p>}
    {eventFeatures.length>0&&<><div className="homeSectionHead" style={{marginTop:28}}><div><div className="homeKicker">From the dancefloor</div><h2 className="homeSectionTitle" style={{marginTop:5}}>Event Features</h2></div></div><ArticleRow articles={eventFeatures}/></>}
  </section>;
}
