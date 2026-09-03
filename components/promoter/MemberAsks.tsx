'use client';

// Guestlist members asking for this promoter's events, with the one press
// that matters: put them on the list. The pass goes out, the desk sees it
// done, and the promoter never has to open a chat.

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import type { PromoterAsk } from '@/lib/accessRequests';

export function MemberAsks({ promoterId, asks, canAct, querySuffix = '' }: { promoterId: string; asks: PromoterAsk[]; canAct: boolean; querySuffix?: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState('');
  const [done, setDone] = useState<Record<string, string>>({});

  async function act(requestId: string, action: 'guestlist' | 'cant') {
    setBusy(requestId); setErr('');
    const r = await fetch(`/api/promoter/${promoterId}/requests`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, requestId }) });
    const j = await r.json().catch(() => ({}));
    setBusy(null);
    if (!r.ok) { setErr(j.error ?? 'Something went wrong'); return; }
    setDone((d) => ({ ...d, [requestId]: action === 'guestlist' ? 'On the list — their pass is on its way.' : 'Handed back to Guestlist.' }));
    router.refresh();
  }

  const when = (a: PromoterAsk) => new Date(a.start_at).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: a.timezone || 'Europe/London' });

  return (
    <div style={{ display: 'grid', gap: 10 }}>
      {asks.map((a) => (
        <div className="adminCard memberAsk" key={a.id}>
          <div>
            <b>{a.member_name}</b>
            <span className="evChip" style={{ marginLeft: 8 }}>Guestlist member</span>
            {a.places > 1 && <span className="evChip amber" style={{ marginLeft: 6 }}>+1</span>}
            <div className="adminSub" style={{ marginTop: 4 }}>
              <Link href={`/promoter/guestlists/${a.event_id}${querySuffix}`} style={{ textDecoration: 'underline' }}>{a.title}</Link> · {when(a)}{a.venue_name ? ` · ${a.venue_name}` : ''}
            </div>
            {a.member_note && <div className="adminSub" style={{ fontStyle: 'italic' }}>“{a.member_note}”</div>}
          </div>
          <div className="memberAskActions">
            {done[a.id]
              ? <span className="formOk">{done[a.id]}</span>
              : canAct ? (
                <>
                  <button className="btnAccent" disabled={busy === a.id} onClick={() => act(a.id, 'guestlist')}>{busy === a.id ? '…' : `Put ${a.places > 1 ? 'them' : a.member_name.split(' ')[0]} on the list`}</button>
                  <button className="btnGhost" disabled={busy === a.id} onClick={() => act(a.id, 'cant')}>Can’t this time</button>
                </>
              ) : <span className="adminSub">Ask an editor on your team</span>}
          </div>
        </div>
      ))}
      {err && <div className="formError">{err}</div>}
    </div>
  );
}
