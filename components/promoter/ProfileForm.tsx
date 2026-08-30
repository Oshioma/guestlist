'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

type Initial = {
  description: string; website: string; imageUrl: string; heroImageUrl: string;
  city: string; country: string; socials: Record<string, string>; genreSlugs: string[];
};

const SOCIALS = ['instagram', 'soundcloud', 'facebook', 'mixcloud', 'bandcamp', 'x'] as const;

export function ProfileForm({
  promoterId,
  initial,
  genres,
}: {
  promoterId: string;
  initial: Initial;
  genres: { slug: string; name: string }[];
}) {
  const router = useRouter();
  const [values, setValues] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const upd = (patch: Partial<Initial>) => setValues((v) => ({ ...v, ...patch }));

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    setMessage('');
    const res = await fetch(`/api/promoter/${promoterId}/profile`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(values),
    });
    setBusy(false);
    if (res.ok) {
      setMessage('Profile saved.');
      router.refresh();
    } else {
      setError((await res.json().catch(() => ({})))?.error ?? 'Save failed');
    }
  }

  return (
    <form className="formCard" style={{ maxWidth: 640, margin: '10px 0 80px' }} onSubmit={onSubmit}>
      <label htmlFor="pr-desc">Description</label>
      <textarea id="pr-desc" rows={4} value={values.description} onChange={(e) => upd({ description: e.target.value })} />
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
        <div>
          <label htmlFor="pr-city">City</label>
          <input id="pr-city" value={values.city} onChange={(e) => upd({ city: e.target.value })} />
        </div>
        <div>
          <label htmlFor="pr-country">Country</label>
          <input id="pr-country" value={values.country} onChange={(e) => upd({ country: e.target.value })} />
        </div>
      </div>
      <label htmlFor="pr-web">Official website</label>
      <input id="pr-web" type="url" value={values.website} onChange={(e) => upd({ website: e.target.value })} />
      <label htmlFor="pr-logo">Logo URL</label>
      <input id="pr-logo" value={values.imageUrl} onChange={(e) => upd({ imageUrl: e.target.value })} />
      <label htmlFor="pr-hero">Hero image URL</label>
      <input id="pr-hero" value={values.heroImageUrl} onChange={(e) => upd({ heroImageUrl: e.target.value })} />

      <label>Genres</label>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        {genres.map((g) => (
          <button key={g.slug} type="button"
                  className={`chip${values.genreSlugs.includes(g.slug) ? ' active' : ''}`}
                  onClick={() => upd({
                    genreSlugs: values.genreSlugs.includes(g.slug)
                      ? values.genreSlugs.filter((s) => s !== g.slug)
                      : [...values.genreSlugs, g.slug],
                  })}>
            {g.name}
          </button>
        ))}
      </div>

      {SOCIALS.map((key) => (
        <div key={key}>
          <label htmlFor={`pr-${key}`} style={{ textTransform: 'capitalize' }}>{key}</label>
          <input id={`pr-${key}`} type="url" placeholder="https://…" value={values.socials[key] ?? ''}
                 onChange={(e) => upd({ socials: { ...values.socials, [key]: e.target.value } })} />
        </div>
      ))}

      <div className="formError">{error}</div>
      {message && <div className="formOk">{message}</div>}
      <button className="btnAccent" style={{ width: '100%', marginTop: 8 }} disabled={busy} type="submit">
        {busy ? 'Saving…' : 'Save profile'}
      </button>
    </form>
  );
}
