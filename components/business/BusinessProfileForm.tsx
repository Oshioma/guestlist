'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

type Values = {
  name: string; tagline: string; description: string; categoryId: string; city: string; country: string; address: string;
  website: string; logoUrl: string; heroImageUrl: string; contactName: string; contactEmail: string; socials: Record<string, string>;
};

const SOCIALS = ['instagram', 'tiktok', 'facebook', 'x'] as const;

export function BusinessProfileForm({ businessId, initial, categories, endpoint, extra }: {
  businessId: string; initial: Values; categories: { id: string; name: string }[];
  // The portal PATCHes its own endpoint; the admin desk posts through the market desk.
  endpoint: 'portal' | 'admin';
  extra?: React.ReactNode;
}) {
  const router = useRouter();
  const [v, setV] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const upd = (patch: Partial<Values>) => setV((x) => ({ ...x, ...patch }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr(''); setMsg('');
    const res = endpoint === 'portal'
      ? await fetch(`/api/business/${businessId}/profile`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(v) })
      : await fetch('/api/admin/market', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'update', businessId, business: v }) });
    setBusy(false);
    const j = await res.json().catch(() => ({}));
    if (res.ok) { setMsg(j.identityChangeFlagged ? 'Saved. A name or website change is flagged for Guestlist to check.' : 'Saved.'); router.refresh(); }
    else setErr(j.error ?? 'Save failed');
  }

  return (
    <form className="formCard" style={{ maxWidth: 640, margin: '10px 0 60px' }} onSubmit={submit}>
      <label htmlFor="b-name">Business name</label>
      <input id="b-name" value={v.name} onChange={(e) => upd({ name: e.target.value })} required />
      <label htmlFor="b-tag">One line</label>
      <input id="b-tag" value={v.tagline} onChange={(e) => upd({ tagline: e.target.value })} placeholder="Independent record shop in Peckham since 2011" />
      <label htmlFor="b-cat">Category</label>
      <select id="b-cat" value={v.categoryId} onChange={(e) => upd({ categoryId: e.target.value })}>
        <option value="">Choose…</option>
        {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
      </select>
      <label htmlFor="b-desc">About</label>
      <textarea id="b-desc" rows={5} value={v.description} onChange={(e) => upd({ description: e.target.value })} />
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
        <div><label htmlFor="b-city">City</label><input id="b-city" value={v.city} onChange={(e) => upd({ city: e.target.value })} /></div>
        <div><label htmlFor="b-country">Country</label><input id="b-country" value={v.country} onChange={(e) => upd({ country: e.target.value })} /></div>
      </div>
      <label htmlFor="b-addr">Address</label>
      <input id="b-addr" value={v.address} onChange={(e) => upd({ address: e.target.value })} />
      <label htmlFor="b-web">Website</label>
      <input id="b-web" value={v.website} onChange={(e) => upd({ website: e.target.value })} placeholder="https://…" />
      <label htmlFor="b-logo">Logo image URL</label>
      <input id="b-logo" value={v.logoUrl} onChange={(e) => upd({ logoUrl: e.target.value })} placeholder="https://… (square)" />
      <label htmlFor="b-hero">Photo URL</label>
      <input id="b-hero" value={v.heroImageUrl} onChange={(e) => upd({ heroImageUrl: e.target.value })} placeholder="https://… (landscape)" />
      <p className="fieldNote">Paste image links for now — the same way promoters do. Uploads come later.</p>
      {SOCIALS.map((k) => (
        <div key={k}>
          <label htmlFor={`b-${k}`} style={{ textTransform: 'capitalize' }}>{k}</label>
          <input id={`b-${k}`} value={v.socials[k] ?? ''} onChange={(e) => upd({ socials: { ...v.socials, [k]: e.target.value } })} placeholder="https://…" />
        </div>
      ))}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
        <div><label htmlFor="b-cn">Contact name</label><input id="b-cn" value={v.contactName} onChange={(e) => upd({ contactName: e.target.value })} /></div>
        <div><label htmlFor="b-ce">Contact email</label><input id="b-ce" value={v.contactEmail} onChange={(e) => upd({ contactEmail: e.target.value })} /></div>
      </div>
      {extra}
      <div className="formError">{err}</div>
      {msg && <div className="formOk">{msg}</div>}
      <button className="btnAccent" style={{ width: '100%', marginTop: 8 }} disabled={busy} type="submit">{busy ? 'Saving…' : 'Save listing'}</button>
    </form>
  );
}
