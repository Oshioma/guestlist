'use client';

// Which optional sections appear in the main navigation.

import { useState } from 'react';
import { useRouter } from 'next/navigation';

type Nav = { explore: boolean; people: boolean };

const ITEMS: { key: keyof Nav; label: string; note: string }[] = [
  { key: 'explore', label: 'Explore', note: 'Cities and destinations' },
  { key: 'people', label: 'People', note: 'Members, connections and your scene' },
];

export function NavToggles({ initial }: { initial: Nav }) {
  const router = useRouter();
  const [nav, setNav] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function toggle(key: keyof Nav) {
    const next = { ...nav, [key]: !nav[key] };
    setNav(next);
    setBusy(true);
    setError(null);
    const res = await fetch('/api/admin/site', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nav: { [key]: next[key] } }),
    }).catch(() => null);
    setBusy(false);
    if (!res?.ok) {
      setNav(nav); // put it back — nothing was saved
      setError('Could not save that. Try again.');
      return;
    }
    router.refresh();
  }

  return (
    <div className="adminCard" style={{ maxWidth: 640 }}>
      <h2 className="sectionLabel" style={{ marginTop: 0 }}>Navigation</h2>
      <div className="youToggleList">
        {ITEMS.map((item) => (
          <label className="notifPrefRow" key={item.key}>
            <input type="checkbox" checked={nav[item.key]} disabled={busy}
                   onChange={() => toggle(item.key)} />
            <span>
              <b>{item.label}</b>
              <span style={{ color: 'var(--text-muted)' }}> — {item.note}</span>
            </span>
          </label>
        ))}
      </div>
      {error && <div className="formError">{error}</div>}
      <p className="adminSub" style={{ marginTop: 12 }}>
        Unticked sections disappear from the header for everyone, including you.
      </p>
    </div>
  );
}
