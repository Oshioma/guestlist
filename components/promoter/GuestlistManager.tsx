'use client';

import { useEffect, useMemo, useState } from 'react';

type Entry = {
  id:string; member_id:string|null; guest_name:string; plus_ones:number; source:string;
  status:'pending'|'confirmed'|'declined'|'cancelled'; notes:string|null; checked_in_at:string|null; created_at:string;
};
type Payload = {
  event:{id:string;title:string;start_at:string;timezone:string};
  settings:{mode:'promoter_only'|'approve_requests'|'auto_fill';max_guestlist_places:number;guestlist_closes_at:string|null;max_plus_ones:number};
  entries:Entry[];
};

const SOURCES = ['promoter','guestlist','artist','partner','competition','invite_link','member_referral'];

export function GuestlistManager({ promoterId, eventId, canEdit }: { promoterId:string; eventId:string; canEdit:boolean }) {
  const endpoint = `/api/promoter/${promoterId}/guestlists/${eventId}`;
  const [data,setData]=useState<Payload|null>(null);
  const [error,setError]=useState('');
  const [busy,setBusy]=useState(false);
  const [search,setSearch]=useState('');
  const [doorMode,setDoorMode]=useState(false);
  const [name,setName]=useState('');
  const [plusOnes,setPlusOnes]=useState(0);
  const [source,setSource]=useState('promoter');

  async function load(){
    setError('');
    const r=await fetch(endpoint,{cache:'no-store'});
    const j=await r.json();
    if(!r.ok){setError(j.error||'Could not load guestlist');return;}
    setData(j);
  }
  useEffect(()=>{void load()},[endpoint]);

  async function act(body:Record<string,unknown>){
    setBusy(true);setError('');
    try{
      const r=await fetch(endpoint,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
      const j=await r.json();
      if(!r.ok) throw new Error(j.error||'Update failed');
      await load();
    }catch(e){setError(e instanceof Error?e.message:'Update failed')}finally{setBusy(false)}
  }

  const active=useMemo(()=>data?.entries.filter(e=>e.status==='pending'||e.status==='confirmed')??[],[data]);
  const visible=useMemo(()=>active.filter(e=>e.guest_name.toLowerCase().includes(search.toLowerCase())),[active,search]);
  const people=active.reduce((n,e)=>n+1+e.plus_ones,0);
  const confirmed=active.filter(e=>e.status==='confirmed').reduce((n,e)=>n+1+e.plus_ones,0);
  const pending=active.filter(e=>e.status==='pending').reduce((n,e)=>n+1+e.plus_ones,0);
  const arrived=active.filter(e=>e.checked_in_at).reduce((n,e)=>n+1+e.plus_ones,0);
  const guestlistNet=active.filter(e=>e.source==='guestlist').reduce((n,e)=>n+1+e.plus_ones,0);

  function csv(){
    if(!data)return;
    const rows=[['Name','Guests','Source','Status','Arrived'],...active.map(e=>[e.guest_name,String(1+e.plus_ones),e.source,e.status,e.checked_in_at?'yes':''])];
    const text=rows.map(r=>r.map(v=>`"${String(v).replaceAll('"','""')}"`).join(',')).join('\n');
    const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([text],{type:'text/csv'}));a.download=`${data.event.title.replace(/[^a-z0-9]+/gi,'-').toLowerCase()}-guestlist.csv`;a.click();URL.revokeObjectURL(a.href);
  }

  if(!data)return <div className="adminCard">{error||'Loading guestlist…'}</div>;
  const s=data.settings;
  return <div className={doorMode?'guestlistDoorMode':''}>
    <style>{`@media print{.dashHeader,.dashNav,.guestlistNoPrint{display:none!important}.guestlistPrint{display:block!important}.guestlistRow{break-inside:avoid}.guestlistDoorMode button{display:none!important}}`}</style>
    <div className="guestlistNoPrint" style={{display:'flex',justifyContent:'space-between',gap:12,flexWrap:'wrap',alignItems:'start'}}>
      <div><div className="sectionLabel">Guestlist</div><h2 style={{margin:'4px 0'}}>{data.event.title}</h2><div className="adminSub">{people} people · {confirmed} confirmed · {pending} pending · {arrived} arrived</div></div>
      <div style={{display:'flex',gap:8,flexWrap:'wrap'}}><button className="btnGhost" onClick={()=>setDoorMode(v=>!v)}>{doorMode?'Exit door mode':'Door mode'}</button><button className="btnGhost" onClick={csv}>CSV</button><button className="btnGhost" onClick={()=>window.print()}>Print</button></div>
    </div>

    {canEdit&&!doorMode&&<div className="adminCard guestlistNoPrint" style={{marginTop:18}}>
      <div className="sectionLabel">Let Guestlist.net help fill this list</div>
      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(180px,1fr))',gap:12,alignItems:'end'}}>
        <label>Mode<select value={s.mode} onChange={e=>setData({...data,settings:{...s,mode:e.target.value as Payload['settings']['mode']}})}><option value="promoter_only">Promoter only</option><option value="approve_requests">Approve requests</option><option value="auto_fill">Auto-fill</option></select></label>
        <label>Guestlist.net places<input type="number" min="0" value={s.max_guestlist_places} onChange={e=>setData({...data,settings:{...s,max_guestlist_places:Number(e.target.value)}})}/></label>
        <label>Max +1s<input type="number" min="0" max="10" value={s.max_plus_ones} onChange={e=>setData({...data,settings:{...s,max_plus_ones:Number(e.target.value)}})}/></label>
        <label>Close requests<input type="datetime-local" value={s.guestlist_closes_at?s.guestlist_closes_at.slice(0,16):''} onChange={e=>setData({...data,settings:{...s,guestlist_closes_at:e.target.value||null}})}/></label>
        <button className="btnAccent" disabled={busy} onClick={()=>act({action:'settings',mode:s.mode,maxGuestlistPlaces:s.max_guestlist_places,maxPlusOnes:s.max_plus_ones,guestlistClosesAt:s.guestlist_closes_at})}>Save guestlist settings</button>
      </div>
      {s.mode!=='promoter_only'&&<p className="adminSub" style={{marginBottom:0}}>Guestlist.net allocation used: {guestlistNet}{s.max_guestlist_places>0?` / ${s.max_guestlist_places}`:' · unlimited'}. {s.mode==='approve_requests'?'Requests wait for your approval.':'Requests are confirmed automatically while space remains.'}</p>}
    </div>}

    {canEdit&&!doorMode&&<div className="adminCard guestlistNoPrint" style={{marginTop:12}}>
      <div style={{display:'grid',gridTemplateColumns:'minmax(180px,2fr) 90px minmax(140px,1fr) auto',gap:8,alignItems:'end'}}>
        <label>Name<input value={name} onChange={e=>setName(e.target.value)} placeholder="Guest name"/></label>
        <label>+1s<input type="number" min="0" max="10" value={plusOnes} onChange={e=>setPlusOnes(Number(e.target.value))}/></label>
        <label>Source<select value={source} onChange={e=>setSource(e.target.value)}>{SOURCES.map(x=><option key={x} value={x}>{x.replaceAll('_',' ')}</option>)}</select></label>
        <button className="btnAccent" disabled={busy||!name.trim()} onClick={async()=>{await act({action:'add',guestName:name,plusOnes,source});setName('');setPlusOnes(0)}}>+ Add guest</button>
      </div>
    </div>}

    {error&&<div className="cancelBanner guestlistNoPrint" style={{marginTop:12}}>{error}</div>}
    <div className="guestlistNoPrint" style={{margin:'16px 0 10px'}}><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search guest…" style={{width:'100%',fontSize:doorMode?20:14,padding:doorMode?16:10}}/></div>

    <div className="guestlistPrint" style={{display:'none'}}><h1>{data.event.title}</h1><p>Guestlist · {new Date(data.event.start_at).toLocaleString()}</p></div>
    <div style={{display:'grid',gap:8}}>{visible.length?visible.map(e=><div key={e.id} className="adminCard guestlistRow" style={{display:'grid',gridTemplateColumns:doorMode?'1fr auto':'minmax(180px,2fr) 80px 120px 110px auto',gap:10,alignItems:'center',opacity:e.status==='pending'?.75:1}}>
      <div><b style={{fontSize:doorMode?20:15}}>{e.guest_name}</b>{e.notes&&!doorMode&&<div className="adminSub">{e.notes}</div>}</div>
      {!doorMode&&<div>{e.plus_ones?`+${e.plus_ones}`:'—'}</div>}
      {!doorMode&&<div className="adminSub">{e.source.replaceAll('_',' ')}</div>}
      {!doorMode&&<div>{e.status}{e.checked_in_at?' · ✓':''}</div>}
      <div className="guestlistNoPrint" style={{display:'flex',gap:6,justifyContent:'flex-end',flexWrap:'wrap'}}>
        {e.status==='pending'&&canEdit&&<><button className="btnAccent" disabled={busy} onClick={()=>act({action:'approve',entryId:e.id})}>Approve</button><button className="btnGhost" disabled={busy} onClick={()=>act({action:'decline',entryId:e.id})}>Decline</button></>}
        {e.status==='confirmed'&&<button className={e.checked_in_at?'btnGhost':'btnAccent'} disabled={busy||!canEdit} onClick={()=>act({action:'check_in',entryId:e.id})}>{e.checked_in_at?'Undo arrival':'Check in'}</button>}
        {!doorMode&&canEdit&&<button className="btnGhost" disabled={busy} onClick={()=>act({action:'remove',entryId:e.id})}>Remove</button>}
      </div>
    </div>):<div className="emptyState">No guests match.</div>}</div>
  </div>;
}
