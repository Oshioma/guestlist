'use client';

// Recommendation shelf: event cards with WHY YOU'RE SEEING IT (reasons,
// never scores) and quick negative feedback (Hide / Not for me).

import { useState } from 'react';
import Link from 'next/link';
import { track } from '@/lib/track';

export type RecCardData = {
  id: string;
  title: string;
  slug: string;
  when: string;        // preformatted, event's own timezone
  city: string | null;
  venue_name: string | null;
  primary_image_url: string | null;
  price: string | null; // original currency, preformatted
  reasons: string[];
  explore: boolean;
};

const FEEDBACK_REASONS: { key: string; label: string }[] = [
  { key: 'wrong_music', label: 'Wrong music' },
  { key: 'too_far', label: 'Too far' },
  { key: 'bad_date', label: 'Bad date' },
  { key: 'not_this_promoter', label: 'Not this promoter' },
  { key: 'other', label: 'Other' },
];

export function RecShelf({ events, title, surface }: { events: RecCardData[]; title?: string; surface: string }) {
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [asking, setAsking] = useState<string | null>(null);

  async function hide(eventId: string, reason?: string) {
    setAsking(null);
    setHidden((prev) => new Set(prev).add(eventId));
    await fetch(`/api/events/${eventId}/feedback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(reason ? { kind: 'not_for_me', reason } : { kind: 'hide' }),
    }).catch(() => {});
  }

  const visible = events.filter((e) => !hidden.has(e.id));
  if (!visible.length) return null;

  return (
    <section className="recShelf">
      {title && <div className="sectionLabel">{title}</div>}
      <div className="recGrid">
        {visible.map((e) => (
          <div className={`recCard${e.explore ? ' isExplore' : ''}`} key={e.id}>
            <Link
              href={`/events/${e.slug}`}
              className="recCardLink"
              onClick={() => track('recommendation_click', { eventId: e.id, surface })}
            >
              {e.primary_image_url && (
                // eslint-disable-next-line @next/next/no-img-element
                <img className="recCardImg" src={e.primary_image_url} alt="" />
              )}
              <div className="recCardBody">
                <div className="recCardTitle">{e.title}</div>
                <div className="recCardMeta">
                  {e.when}
                  {e.venue_name && ` · ${e.venue_name}`}
                  {e.city && ` · ${e.city}`}
                  {e.price && ` · ${e.price}`}
                </div>
                {e.reasons.length > 0 && (
                  <div className="recReasons">
                    {e.reasons.map((r, i) => (
                      <span className="recReason" key={i}>{r}</span>
                    ))}
                  </div>
                )}
              </div>
            </Link>
            <div className="recCardActions">
              {asking === e.id ? (
                <div className="recFeedback">
                  {FEEDBACK_REASONS.map((r) => (
                    <button key={r.key} className="chip" type="button" onClick={() => hide(e.id, r.key)}>
                      {r.label}
                    </button>
                  ))}
                  <button className="chip" type="button" onClick={() => setAsking(null)}>Cancel</button>
                </div>
              ) : (
                <>
                  <button className="recHide" type="button" title="Hide this event" onClick={() => hide(e.id)}>
                    Hide
                  </button>
                  <button className="recHide" type="button" onClick={() => setAsking(e.id)}>
                    Not for me
                  </button>
                </>
              )}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
