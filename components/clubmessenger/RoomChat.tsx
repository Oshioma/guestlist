'use client';

// Live room chat: chronological, polled every 10s (visible tab only).
// V1 keeps transport simple — the polling endpoint takes ?after= so each
// poll only moves new rows.

import { useCallback, useEffect, useRef, useState } from 'react';

type Message = {
  id: string;
  body: string;
  created_at: string;
  member_id: string;
  display_name: string;
  avatar_url: string | null;
};

export function RoomChat({
  eventId,
  initialMessages,
  meId,
}: {
  eventId: string;
  initialMessages: Message[];
  meId: string;
}) {
  const [messages, setMessages] = useState<Message[]>(initialMessages);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reported, setReported] = useState<Set<string>>(new Set());
  const listRef = useRef<HTMLDivElement>(null);
  const lastTs = useRef<string | null>(
    initialMessages.length ? initialMessages[initialMessages.length - 1].created_at : null
  );

  const scrollDown = useCallback(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, []);

  useEffect(() => {
    scrollDown();
  }, [messages.length, scrollDown]);

  useEffect(() => {
    const t = setInterval(async () => {
      if (document.visibilityState !== 'visible') return;
      try {
        const url = lastTs.current
          ? `/api/clubmessenger/rooms/${eventId}/messages?after=${encodeURIComponent(lastTs.current)}`
          : `/api/clubmessenger/rooms/${eventId}/messages`;
        const res = await fetch(url);
        if (!res.ok) return;
        const data = await res.json();
        if (data.messages?.length) {
          setMessages((prev) => {
            const seen = new Set(prev.map((m) => m.id));
            const fresh = (data.messages as Message[]).filter((m) => !seen.has(m.id));
            if (!fresh.length) return prev;
            lastTs.current = fresh[fresh.length - 1].created_at;
            return [...prev, ...fresh];
          });
        }
      } catch {
        /* next poll retries */
      }
    }, 10_000);
    return () => clearInterval(t);
  }, [eventId]);

  async function sendMessage(e: React.FormEvent) {
    e.preventDefault();
    const body = draft.trim();
    if (!body || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/clubmessenger/rooms/${eventId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? 'Message not sent');
      } else {
        setDraft('');
        setMessages((prev) => {
          if (prev.some((m) => m.id === data.message.id)) return prev;
          lastTs.current = data.message.created_at;
          return [...prev, data.message];
        });
      }
    } finally {
      setBusy(false);
    }
  }

  async function report(messageId: string) {
    setReported((prev) => new Set(prev).add(messageId));
    await fetch(`/api/clubmessenger/rooms/${eventId}/messages/${messageId}/report`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    }).catch(() => {});
  }

  return (
    <div className="roomChat">
      <div className="roomChatList" ref={listRef}>
        {messages.length === 0 && (
          <div className="roomChatEmpty">
            Nothing yet — say something to the room. Everyone going or here
            tonight can read it.
          </div>
        )}
        {messages.map((m) => (
          <div className={`roomMsg${m.member_id === meId ? ' mine' : ''}`} key={m.id}>
            <div className="roomMsgMeta">
              <span className="roomMsgName">{m.member_id === meId ? 'You' : m.display_name}</span>
              <span className="roomMsgTime">
                {new Date(m.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </span>
              {m.member_id !== meId && (
                <button
                  className="roomMsgReport"
                  type="button"
                  disabled={reported.has(m.id)}
                  onClick={() => report(m.id)}
                  title="Report message"
                >
                  {reported.has(m.id) ? 'Reported' : 'Report'}
                </button>
              )}
            </div>
            <div className="roomMsgBody">{m.body}</div>
          </div>
        ))}
      </div>
      <form className="roomChatForm" onSubmit={sendMessage}>
        <input
          value={draft}
          maxLength={500}
          placeholder="Message the room…"
          onChange={(e) => setDraft(e.target.value)}
        />
        <button className="btnAccent" type="submit" disabled={busy || !draft.trim()}>
          Send
        </button>
      </form>
      {error && <div className="formError">{error}</div>}
    </div>
  );
}
