import { EventImage } from '@/components/EventImage';
import Link from 'next/link';
import { query } from '@/lib/db';
import { youtubeTimestampUrl } from '@/lib/videoArchive';

export const dynamic = 'force-dynamic';

type Row = { id:string; start_seconds:number; title:string; summary:string|null; topic_label:string|null; youtube_video_id:string; video_title:string; artist_name:string|null; artist_slug:string|null; thumbnail_url:string|null };

export default async function ClipsPage({ searchParams }: { searchParams: Promise<{ q?: string; video?: string }> }) {
  const sp = await searchParams; const q = (sp.q || '').trim();
  const args: unknown[] = []; const where = [`v.status='published'`, `m.status='published'`];
  if (sp.video) { args.push(sp.video); where.push(`v.id=$${args.length}`); }
  if (q) { args.push(q); const n=args.length; where.push(`(m.title ilike '%'||$${n}||'%' or coalesce(m.summary,'') ilike '%'||$${n}||'%' or coalesce(m.transcript_excerpt,'') ilike '%'||$${n}||'%' or coalesce(m.topic_label,'') ilike '%'||$${n}||'%')`); }
  const moments = await query<Row>(`select m.id,m.start_seconds,m.title,m.summary,m.topic_label,v.youtube_video_id,v.title video_title,v.thumbnail_url,a.name artist_name,a.slug artist_slug
    from artist_video_moments m join artist_videos v on v.id=m.video_id
    left join lateral (select a2.name,a2.slug from artist_video_artists va join artists a2 on a2.id=va.artist_id where va.video_id=v.id and va.role='interviewee' limit 1) a on true
    where ${where.join(' and ')} order by v.published_at desc nulls last,m.start_seconds limit 100`, args);
  return <main className="wrap" style={{paddingBottom:80}}>
    <div className="eyebrow" style={{marginTop:36}}>GUESTLIST VIDEO ARCHIVE</div>
    <h1 className="pageTitle">In their words</h1>
    <p className="pageIntro">The moments buried inside years of Guestlist conversations with DJs and artists.</p>
    <form style={{display:'flex',gap:8,maxWidth:680,margin:'26px 0 32px'}}><input name="q" defaultValue={q} placeholder="Search jungle, Ibiza, Metalheadz, The End…" style={{flex:1,padding:'13px 14px'}}/><button className="btn" type="submit">Search</button></form>
    {moments.length ? <div className="cardGrid">{moments.map(m=><article className="card" key={m.id} style={{overflow:'hidden'}}>
      {m.thumbnail_url && <EventImage src={m.thumbnail_url} style={{width:'100%',aspectRatio:'16/9',objectFit:'cover'}}/>}
      <div style={{padding:16}}><div className="adminSub">{m.artist_slug?<Link href={`/artists/${m.artist_slug}`}>{m.artist_name}</Link>:m.video_title}</div><h3>{m.title}</h3>{m.summary&&<p>{m.summary}</p>}
      <a className="btn" target="_blank" rel="noreferrer" href={youtubeTimestampUrl(m.youtube_video_id,m.start_seconds)}>Watch from {Math.floor(m.start_seconds/60)}:{String(m.start_seconds%60).padStart(2,'0')} →</a></div>
    </article>)}</div>:<p className="adminSub">No published moments yet.</p>}
  </main>;
}
