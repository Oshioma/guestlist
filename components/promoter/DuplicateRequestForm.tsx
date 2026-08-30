'use client';

// Flag two listings as the same event (or explicitly keep both).

import { useState } from 'react';
import { useRouter } from 'next/navigation';

type EventOption = { id: string; title: string; start: string };

export function DuplicateRequestForm({
  promoterId, events,
}: {
  promoterId: string;
  events: EventOption[];
}) {
  const router = useRouter();
  const [form, setForm] = useState({ eventId: '', duplicateOfEventId: '', action: 'same_event', note: '' });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.eventId || !form.duplicateOfEventId || form.eventId === form.duplicateOfEventId) {
      setMsg('Pick two different listings');
      return;
    }
    setBusy(true);
    setMsg(null);
    const res = await fetch('/api/promoter/duplicates', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ promoterId, ...form }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (res.ok) {
      setMsg(form.action === 'keep_both'
        ? 'Done — both listings stay.'
        : 'Sent — a Guestlist admin will review the merge.');
      setForm({ eventId: '', duplicateOfEventId: '', action: 'same_event', note: '' });
      router.refresh();
    } else {
      setMsg(data.error ?? 'Something went wrong');
    }
  }

  return (
    <form className="youProfileForm" onSubmit={submit}>
      <div className="youNewGrid">
        <select value={form.eventId} onChange={(e) => setForm({ ...form, eventId: e.target.value })}>
          <option value="">Keep this listing…</option>
          {events.map((ev) => (
            <option key={ev.id} value={ev.id}>{ev.title} — {ev.start}</option>
          ))}
        </select>
        <select value={form.duplicateOfEventId} onChange={(e) => setForm({ ...form, duplicateOfEventId: e.target.value })}>
          <option value="">…this one is the duplicate</option>
          {events.map((ev) => (
            <option key={ev.id} value={ev.id}>{ev.title} — {ev.start}</option>
          ))}
        </select>
        <select value={form.action} onChange={(e) => setForm({ ...form, action: e.target.value })}>
          <option value="same_event">This is the same event</option>
          <option value="request_merge">Request merge</option>
          <option value="keep_both">Keep both (not duplicates)</option>
        </select>
        <input placeholder="Note (optional)" value={form.note} maxLength={500}
               onChange={(e) => setForm({ ...form, note: e.target.value })} />
      </div>
      <div className="youPanelActions">
        <button className="btnAccent" type="submit" disabled={busy}>Send</button>
        {msg && <span className="youHistoryMeta">{msg}</span>}
      </div>
    </form>
  );
}
