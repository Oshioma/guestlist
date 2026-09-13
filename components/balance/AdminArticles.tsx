'use client';
import { useEffect, useRef, useState } from 'react';

type A={id:string;title:string;subtitle:string|null;author_name:string;status:string;section_slug?:string;section_name?:string;article_type:string;hero_image_url:string|null;hero_image_alt:string|null;excerpt:string|null;body:string;tags:string[];admin_note:string|null;featured:boolean;updated_at:string;view_count:number;slug:string};
const TYPES=['story','opinion','guide','interview','reflection','photo-essay','list'];

// "Live" rather than "published", because the question an editor is actually
// asking the page is whether the thing is out in the world.
const STATUS_WORD:Record<string,string>={
 published:'Live', submitted:'Waiting on you', changes_requested:'Changes asked for',
 approved:'Approved, not out', draft:'Draft', rejected:'Rejected', archived:'Archived',
};
// The two states where nothing moves until an editor does something.
const NEEDS_YOU=new Set(['submitted','changes_requested']);
// The filters, in the order the desk is useful: what is stuck, then what is out.
const FILTERS:{key:string;label:string;match:(a:{status:string})=>boolean}[]=[
 {key:'all',label:'Everything',match:()=>true},
 {key:'needs',label:'Waiting on you',match:a=>NEEDS_YOU.has(a.status)},
 {key:'approved',label:'Approved, not out',match:a=>a.status==='approved'},
 {key:'published',label:'Live',match:a=>a.status==='published'},
 {key:'draft',label:'Drafts',match:a=>a.status==='draft'},
 {key:'gone',label:'Rejected or archived',match:a=>a.status==='rejected'||a.status==='archived'},
];
export function AdminArticles({initial,openId=null}:{initial:A[];openId?:string|null}){
 const [items,setItems]=useState(initial);const [notes,setNotes]=useState<Record<string,string>>({});const [busy,setBusy]=useState<string|null>(null);const [msg,setMsg]=useState('');const [editing,setEditing]=useState<string|null>(openId);const [filter,setFilter]=useState('all');
 const opened=useRef(false);
 // Arriving from a live article: bring the piece into view, once.
 useEffect(()=>{if(!openId||opened.current)return;opened.current=true;document.getElementById(`article-${openId}`)?.scrollIntoView({block:'start'});},[openId]);
 function patch(id:string,p:Partial<A>){setItems(xs=>xs.map(x=>x.id===id?{...x,...p}:x))}
 async function request(id:string,payload:Record<string,unknown>){setBusy(id);setMsg('');try{const r=await fetch(`/api/admin/articles/${id}`,{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify(payload)});const d=await r.json();if(!r.ok)throw new Error(d.error||'Failed');setItems(xs=>xs.map(x=>x.id===id?d.article:x));setMsg('Updated.');return true;}catch(e){setMsg(e instanceof Error?e.message:'Failed');return false}finally{setBusy(null)}}
 async function act(id:string,action:string,featured?:boolean){await request(id,{action,note:notes[id]||'',featured})}
 // REJECT IS NOT DELETE. Rejecting sets a status and leaves the piece on the
 // desk, which is right for something a writer might revise — and wrong for
 // the untitled drafts somebody opened and abandoned, which pile up for ever
 // with nothing to do about them. Asked for by name, because it is the one
 // action here that cannot be undone.
 async function remove(a:A){
   if(!confirm(`Delete "${a.title||'Untitled draft'}" for good? This cannot be undone.`))return;
   setBusy(a.id);setMsg('');
   try{
     const r=await fetch(`/api/admin/articles/${a.id}`,{method:'DELETE'});
     const d=await r.json().catch(()=>({}));
     if(!r.ok)throw new Error(d.error||'Failed');
     setItems(xs=>xs.filter(x=>x.id!==a.id));setMsg('Deleted.');
   }catch(e){setMsg(e instanceof Error?e.message:'Failed')}finally{setBusy(null)}
 }
 async function saveEdit(a:A){const ok=await request(a.id,{action:'edit',title:a.title,subtitle:a.subtitle,excerpt:a.excerpt,body:a.body,article_type:a.article_type,hero_image_url:a.hero_image_url,hero_image_alt:a.hero_image_alt,tags:a.tags});if(ok)setEditing(null)}
 return <div style={{padding:'28px 0 60px'}}><div style={{display:'flex',justifyContent:'space-between',gap:16,alignItems:'end',marginBottom:22}}><div><div className="sectionLabel">Editorial</div><h1 style={{margin:'5px 0 0'}}>Articles</h1></div><span style={{color:'var(--text-muted)'}}>{items.filter(x=>NEEDS_YOU.has(x.status)).length} waiting on you · {items.filter(x=>x.status==='published').length} live</span></div>
 <div className="statePills">{FILTERS.map(f=>{const n=items.filter(f.match).length;return <button key={f.key} type="button" className={`statePill${filter===f.key?' active':''}`} onClick={()=>setFilter(f.key)} style={{background:filter===f.key?undefined:'transparent',cursor:'pointer'}}>{f.label}<span className="n">{n}</span></button>;})}</div>
 {msg&&<p style={{color:'var(--text-muted)'}}>{msg}</p>}<div style={{display:'grid',gap:16}}>{items.filter(FILTERS.find(f=>f.key===filter)?.match??(()=>true)).map(a=><article key={a.id} id={`article-${a.id}`} className={`adminArticleCard${a.status==='published'?' isPublished':NEEDS_YOU.has(a.status)?' needsYou':''}`} style={{border:'1px solid var(--border)',borderRadius:'var(--radius)',padding:18,display:'grid',gridTemplateColumns:a.hero_image_url?'180px 1fr':'1fr',gap:18,background:'var(--bg-raised)'}}>{a.hero_image_url&&<img src={a.hero_image_url} alt="" style={{width:'100%',aspectRatio:'4/3',objectFit:'cover',borderRadius:12}}/>}<div><div style={{display:'flex',gap:10,flexWrap:'wrap',alignItems:'center',fontSize:11,textTransform:'uppercase',letterSpacing:'.08em',color:'var(--text-faint)',fontWeight:800}}><span className={`artStatus ${a.status}`}>{STATUS_WORD[a.status]??a.status.replace('_',' ')}</span><span>{a.section_name??(a.section_slug==='events'?'Event feature':'Balance')}</span><span>· {a.article_type}</span><span>· {a.author_name}</span><span>· {a.view_count} views</span>{a.featured&&<span style={{color:'var(--accent-ink)'}}>· ★ Featured</span>}</div><h2 style={{margin:'7px 0'}}>{a.title||'Untitled draft'}</h2>{a.excerpt&&<p style={{color:'var(--text-soft)',margin:'0 0 10px'}}>{a.excerpt}</p>}
 {editing===a.id?<div style={{display:'grid',gap:9,marginTop:12}}><input value={a.title} onChange={e=>patch(a.id,{title:e.target.value})} placeholder="Headline" style={field}/><input value={a.subtitle||''} onChange={e=>patch(a.id,{subtitle:e.target.value})} placeholder="Subtitle" style={field}/><select value={a.article_type} onChange={e=>patch(a.id,{article_type:e.target.value})} style={field}>{TYPES.map(t=><option key={t}>{t}</option>)}</select><textarea value={a.excerpt||''} onChange={e=>patch(a.id,{excerpt:e.target.value})} rows={2} placeholder="Excerpt" style={field}/><textarea value={a.body} onChange={e=>patch(a.id,{body:e.target.value})} rows={14} style={{...field,lineHeight:1.55}}/><input value={a.hero_image_url||''} onChange={e=>patch(a.id,{hero_image_url:e.target.value})} placeholder="Hero image URL" style={field}/><input value={a.tags.join(', ')} onChange={e=>patch(a.id,{tags:e.target.value.split(',').map(x=>x.trim()).filter(Boolean)})} placeholder="Tags" style={field}/><div style={{display:'flex',gap:8}}><button className="btnAccent" disabled={busy===a.id} onClick={()=>saveEdit(a)}>Save editorial edits</button><button className="btnGhost" onClick={()=>setEditing(null)}>Close</button></div></div>:<details><summary style={{cursor:'pointer',color:'var(--text-muted)'}}>Read draft</summary><div style={{whiteSpace:'pre-wrap',lineHeight:1.6,maxWidth:760,marginTop:10}}>{a.body}</div></details>}
 <textarea value={notes[a.id]??a.admin_note??''} onChange={e=>setNotes(n=>({...n,[a.id]:e.target.value}))} placeholder="Editor note / requested changes" rows={3} style={{...field,marginTop:12}}/><div style={{display:'flex',gap:8,flexWrap:'wrap',marginTop:10}}><button className="btnGhost" disabled={busy===a.id} onClick={()=>setEditing(editing===a.id?null:a.id)}>{editing===a.id?'Close edit':'Edit article'}</button><button className="btnGhost" disabled={busy===a.id} onClick={()=>act(a.id,'request_changes')}>Request changes</button><button className="btnGhost" disabled={busy===a.id} onClick={()=>act(a.id,'approve')}>Approve</button><button className="btnAccent" disabled={busy===a.id} onClick={()=>act(a.id,'publish')}>Publish</button><button className="btnGhost" disabled={busy===a.id} onClick={()=>act(a.id,'feature',!a.featured)}>{a.featured?'Unfeature':'Feature'}</button>{a.status==='published'&&<a className="btnGhost" href={`/balance/${a.slug}`} target="_blank">View live ↗</a>}<button className="btnGhost" disabled={busy===a.id} onClick={()=>act(a.id,'reject')}>Reject</button>{a.status==='published'&&<button className="btnGhost" disabled={busy===a.id} onClick={()=>act(a.id,'archive')}>Archive</button>}<button className="btnGhost adminDanger" disabled={busy===a.id} onClick={()=>remove(a)}>Delete</button></div></div></article>)}</div></div>}
const field:React.CSSProperties={width:'100%',padding:10,border:'1px solid var(--border)',borderRadius:10,background:'var(--bg)',color:'var(--text)',font:'inherit'};
