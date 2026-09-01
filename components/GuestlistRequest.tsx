'use client';

import { useState } from 'react';

export function GuestlistRequest({ eventId, isSignedIn, mode, maxPlusOnes }: { eventId:string; isSignedIn:boolean; mode:'approve_requests'|'auto_fill'; maxPlusOnes:number }) {
  const [plusOnes,setPlusOnes]=useState(0);
  const [state,setState]=useState<'idle'|'busy'|'pending'|'confirmed'|'error'>('idle');
  const [message,setMessage]=useState('');
  async function submit(){
    if(!isSignedIn){window.location.href=`/login?next=${encodeURIComponent(window.location.pathname)}`;return;}
    setState('busy');setMessage('');
    try{
      const r=await fetch(`/api/events/${eventId}/guestlist-request`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({plusOnes})});
      const j=await r.json();
      if(!r.ok) throw new Error(j.error||'Could not request guestlist');
      setState(j.status==='confirmed'?'confirmed':'pending');
    }catch(e){setState('error');setMessage(e instanceof Error?e.message:'Could not request guestlist')}
  }
  if(state==='confirmed') return <div className="adminCard" style={{marginTop:14}}><b>✓ You’re on the guestlist</b><div className="adminSub">Your place is confirmed. Check the event details for entry time and bring ID if the venue requires it.</div></div>;
  if(state==='pending') return <div className="adminCard" style={{marginTop:14}}><b>Guestlist requested</b><div className="adminSub">The promoter will approve or decline your request.</div></div>;
  return <div className="adminCard" style={{marginTop:14}}>
    <div className="sectionLabel">Guestlist</div>
    <b>{mode==='auto_fill'?'Get on the guestlist':'Request guestlist'}</b>
    <div className="adminSub" style={{margin:'6px 0 10px'}}>{mode==='auto_fill'?'Places are confirmed automatically while the allocation lasts.':'Your request goes to the promoter for approval.'}</div>
    <div style={{display:'flex',gap:8,alignItems:'end',flexWrap:'wrap'}}>
      {maxPlusOnes>0&&<label style={{minWidth:90}}>+1s<select value={plusOnes} onChange={e=>setPlusOnes(Number(e.target.value))}>{Array.from({length:maxPlusOnes+1},(_,i)=><option key={i} value={i}>{i}</option>)}</select></label>}
      <button className="btnAccent" disabled={state==='busy'} onClick={submit}>{state==='busy'?'Requesting…':isSignedIn?'Request guestlist':'Sign in to request'}</button>
    </div>
    {state==='error'&&<div className="adminSub" style={{marginTop:8}}>{message}</div>}
  </div>;
}
