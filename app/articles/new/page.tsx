import Link from 'next/link';

export const metadata={title:'Add article · Guestlist'};

export default function AddArticlePage(){
  return <main className="wrap" style={{paddingTop:48,paddingBottom:72,maxWidth:900}}>
    <div className="homeKicker">Community editorial</div>
    <h1 style={{fontSize:'clamp(36px,6vw,64px)',lineHeight:.95,margin:'8px 0 14px'}}>Add an article</h1>
    <p style={{fontSize:18,color:'var(--text-muted)',maxWidth:650,marginBottom:28}}>Choose where your piece belongs. Both go through the same Guestlist editorial review before publishing.</p>
    <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(260px,1fr))',gap:18}}>
      <Link href="/balance/write?section=balance" style={{display:'block',padding:26,border:'1px solid var(--border)',borderRadius:'var(--radius)',background:'var(--bg-raised)',textDecoration:'none'}}>
        <div className="homeKicker">Balance</div><h2 style={{fontSize:30,margin:'8px 0'}}>Balance Article</h2><p style={{color:'var(--text-muted)',margin:0}}>Ideas, reflections, guides, interviews and perspectives from the community.</p>
      </Link>
      <Link href="/balance/write?section=events" style={{display:'block',padding:26,border:'1px solid var(--border)',borderRadius:'var(--radius)',background:'var(--bg-raised)',textDecoration:'none'}}>
        <div className="homeKicker">Events</div><h2 style={{fontSize:30,margin:'8px 0'}}>Event Feature</h2><p style={{color:'var(--text-muted)',margin:0}}>Write about a night, festival, venue or event experience — previews, reviews and scene stories.</p>
      </Link>
    </div>
  </main>;
}
