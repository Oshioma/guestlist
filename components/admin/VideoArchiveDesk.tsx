'use client';
import { useEffect, useState } from 'react';

type Video={id:string;title:string;thumbnail_url:string|null;published_at:string|null;status:string;is_interview:boolean;transcript_status:string;moment_count:number;review_count:number;artists:Array<{name:string}>};
type Moment={id:string;video_id:string;video_title:string;youtube_video_id:string;start_seconds:number;title:string;summary:string|null;topic_label:string|null};
export function VideoArchiveDesk(){
 const [videos,setVideos]=useState<Video[]>([]); const [moments,setMoments]=useState<Moment[]>([]); const [busy,setBusy]=useState(''); const [msg,setMsg]=useState(''); const [transcript,setTranscript]=useState<Record<string,string>>({}); const [selected,setSelected]=useState<Set<string>>(new Set());
 async function load(){const r=await fetch('/api/admin/video-archive'); if(r.ok){const j=await r.json();setVideos(j.videos||[]);setMoments(j.moments||[]);setSelected(prev=>new Set([...prev].filter(id=>(j.videos||[]).some((v:Video)=>v.id===id))))}}
 useEffect(()=>{load()},[]);
 async function act(body:Record<string,unknown>,key=''){setBusy(key);setMsg('');const r=await fetch('/api/admin/video-archive',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});const j=await r.json();setMsg(r.ok?(j.deleted!=null?`${j.deleted} videos deleted.`:j.updated!=null?`${j.updated} moments updated.`:j.created?`Created ${j.created} review moments.`:'Saved.'):j.error||'Action failed');setBusy('');if(r.ok)load();return {ok:r.ok,data:j}}
 async function sync(){
   setBusy('sync'); setMsg('Starting YouTube sync…');
   let reset=true; let total=0;
   try{
     while(true){
       const r=await fetch('/api/admin/video-archive',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:'sync',channelKey:'oshioma',reset})});
       const j=await r.json();
       if(!r.ok) throw new Error(j.error||'Sync failed');
       reset=false; total+=Number(j.processed||0);
       setMsg(`YouTube sync: ${total} videos processed${j.done?' — complete.':'…'}`);
       if(j.done) break;
     }
     await load();
   }catch(e){setMsg(e instanceof Error?e.message:'Sync failed');}
   finally{setBusy('');}
 }
 function toggle(id:string){setSelected(prev=>{const next=new Set(prev);next.has(id)?next.delete(id):next.add(id);return next})}
 function toggleAll(){setSelected(selected.size===videos.length?new Set():new Set(videos.map(v=>v.id)))}
 async function deleteSelected(){
   const count=selected.size;if(!count)return;
   if(!window.confirm(`Permanently delete ${count} selected video${count===1?'':'s'} from Guestlist? This removes their artist links and moments too. It does NOT delete anything from YouTube.`))return;
   const result=await act({action:'delete-videos',videoIds:[...selected]},'delete-videos');
   if(result.ok)setSelected(new Set());
 }
 async function bulk(decision:'publish'|'reject'){
   const label=decision==='publish'?'publish every moment currently awaiting review':'reject every moment currently awaiting review';
   if(!window.confirm(`Are you sure you want to ${label}?`))return;
   await act({action:'bulk-review',decision},`bulk-${decision}`);
 }
 async function hideMoment(m:Moment){if(!window.confirm(`Remove “${m.title}” from the review queue/public archive? It will be hidden, not permanently erased.`))return;await act({action:'hide-moment',momentId:m.id},m.id)}
 const allSelected=videos.length>0&&selected.size===videos.length;
 return <div><div className="adminHeader"><div><h1>Video Archive</h1><p className="adminSub">Guestlist interviews → artists → transcript intelligence → timestamped moments → Ask.</p></div><button className="btn" disabled={!!busy} onClick={sync}>{busy==='sync'?'Syncing in batches…':'Sync YouTube channel'}</button></div>
 {msg&&<p className="adminSub">{msg}</p>}
 {videos.length>0&&<div className="adminCard" style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:12,marginTop:24,flexWrap:'wrap'}}><label style={{display:'flex',alignItems:'center',gap:8,cursor:'pointer'}}><input type="checkbox" checked={allSelected} onChange={toggleAll}/><b>{allSelected?'All videos selected':'Select all videos'}</b><span className="adminSub">{selected.size?`${selected.size} selected`:`${videos.length} videos`}</span></label><button className="btn btnSmall" disabled={!selected.size||!!busy} onClick={deleteSelected}>{busy==='delete-videos'?'Deleting…':`Delete selected${selected.size?` (${selected.size})`:''}`}</button></div>}
 <div style={{display:'grid',gap:12,marginTop:12}}>{videos.map(v=><div className="adminCard" key={v.id} style={{outline:selected.has(v.id)?'2px solid currentColor':'none'}}>
  <div style={{display:'grid',gridTemplateColumns:'28px 120px 1fr auto',gap:14,alignItems:'center'}}><input type="checkbox" checked={selected.has(v.id)} onChange={()=>toggle(v.id)} aria-label={`Select ${v.title}`}/>{v.thumbnail_url?<img src={v.thumbnail_url} alt="" style={{width:120,aspectRatio:'16/9',objectFit:'cover'}}/>:<div/>}<div><b>{v.title}</b><div className="adminSub">{v.artists?.map(a=>a.name).join(', ')||'Artist not matched'} · {v.moment_count} moments {v.review_count?`· ${v.review_count} awaiting review`:''} · transcript {v.transcript_status}</div></div>
  <div style={{display:'flex',gap:6,flexWrap:'wrap'}}><button className="btn btnSmall" onClick={()=>act({action:'update',videoId:v.id,isInterview:!v.is_interview})}>{v.is_interview?'Interview ✓':'Mark interview'}</button><button className="btn btnSmall" onClick={()=>act({action:'update',videoId:v.id,status:v.status==='published'?'draft':'published'})}>{v.status==='published'?'Unpublish':'Publish'}</button>{v.transcript_status==='ready'&&<button className="btn btnSmall" disabled={busy===v.id} onClick={()=>act({action:'extract',videoId:v.id},v.id)}>{busy===v.id?'Reading…':'AI moments'}</button>}</div></div>
  {v.is_interview&&v.transcript_status!=='ready'&&<div style={{marginTop:12}}><textarea value={transcript[v.id]||''} onChange={e=>setTranscript({...transcript,[v.id]:e.target.value})} placeholder="Paste transcript here. Keep timestamps if the transcript includes them." rows={5} style={{width:'100%'}}/><button className="btn btnSmall" disabled={!transcript[v.id]?.trim()} onClick={()=>act({action:'update',videoId:v.id,transcript:transcript[v.id]})}>Save transcript</button></div>}
 </div>)}</div>
 {moments.length>0&&<><div style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:12,marginTop:34,flexWrap:'wrap'}}><div className="sectionLabel">AI MOMENTS TO REVIEW · {moments.length}</div><div style={{display:'flex',gap:8}}><button className="btn btnSmall" disabled={!!busy} onClick={()=>bulk('publish')}>{busy==='bulk-publish'?'Publishing…':'Publish all'}</button><button className="btn btnSmall" disabled={!!busy} onClick={()=>bulk('reject')}>{busy==='bulk-reject'?'Rejecting…':'Reject all'}</button></div></div><div style={{display:'grid',gap:10}}>{moments.map(m=><div className="adminCard" key={m.id}><b>{m.title}</b><div className="adminSub">{m.video_title} · {Math.floor(m.start_seconds/60)}:{String(m.start_seconds%60).padStart(2,'0')}{m.topic_label?` · ${m.topic_label}`:''}</div>{m.summary&&<p>{m.summary}</p>}<div style={{display:'flex',gap:8,flexWrap:'wrap'}}><a className="btn btnSmall" target="_blank" rel="noreferrer" href={`https://www.youtube.com/watch?v=${m.youtube_video_id}&t=${m.start_seconds}s`}>Check moment ↗</a><button className="btn btnSmall" onClick={()=>act({action:'review',momentId:m.id,decision:'publish'})}>Publish</button><button className="btn btnSmall" onClick={()=>act({action:'review',momentId:m.id,decision:'reject'})}>Reject</button><button className="btn btnSmall" onClick={()=>hideMoment(m)}>Delete</button></div></div>)}</div></>}
 </div>
}
