'use client';
import { useEffect, useState } from 'react';

type Video={id:string;title:string;thumbnail_url:string|null;published_at:string|null;status:string;is_interview:boolean;transcript_status:string;moment_count:number;artists:Array<{name:string}>};
export function VideoArchiveDesk(){
 const [videos,setVideos]=useState<Video[]>([]); const [busy,setBusy]=useState(false); const [msg,setMsg]=useState('');
 async function load(){const r=await fetch('/api/admin/video-archive'); if(r.ok)setVideos((await r.json()).videos||[])}
 useEffect(()=>{load()},[]);
 async function sync(){setBusy(true);setMsg('');const r=await fetch('/api/admin/video-archive',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:'sync',channelKey:'oshioma'})});const j=await r.json();setMsg(r.ok?`Imported ${j.imported}, updated ${j.updated}.`:j.error||'Sync failed');setBusy(false);if(r.ok)load()}
 async function patch(v:Video,change:Record<string,unknown>){await fetch('/api/admin/video-archive',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:'update',videoId:v.id,...change})});load()}
 return <div><div className="adminHeader"><div><h1>Video Archive</h1><p className="adminSub">Guestlist interviews → artists → timestamped moments → Ask.</p></div><button className="btn" disabled={busy} onClick={sync}>{busy?'Syncing…':'Sync YouTube channel'}</button></div>
 {msg&&<p className="adminSub">{msg}</p>}
 {!process.env.NEXT_PUBLIC_YOUTUBE_READY&&<p className="adminSub">Live sync requires <b>YOUTUBE_API_KEY</b> in Vercel. The desk itself works without it.</p>}
 <div style={{display:'grid',gap:10,marginTop:24}}>{videos.map(v=><div className="adminCard" key={v.id} style={{display:'grid',gridTemplateColumns:'120px 1fr auto',gap:14,alignItems:'center'}}>
 {v.thumbnail_url?<img src={v.thumbnail_url} alt="" style={{width:120,aspectRatio:'16/9',objectFit:'cover'}}/>:<div/>}<div><b>{v.title}</b><div className="adminSub">{v.artists?.map(a=>a.name).join(', ')||'Artist not matched'} · {v.moment_count} moments · transcript {v.transcript_status}</div></div>
 <div style={{display:'flex',gap:6,flexWrap:'wrap'}}><button className="btn btnSmall" onClick={()=>patch(v,{isInterview:!v.is_interview})}>{v.is_interview?'Interview ✓':'Mark interview'}</button><button className="btn btnSmall" onClick={()=>patch(v,{status:v.status==='published'?'draft':'published'})}>{v.status==='published'?'Unpublish':'Publish'}</button></div>
 </div>)}</div></div>
}
