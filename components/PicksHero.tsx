'use client';

// PICKS FOR YOU as a proper marquee — big flyer artwork up top, the way the
// original Guestlist site led with the night itself. A strip of large
// flyers, the featured one framed; its name in big type below with
// Guest list / Tickets actions. Keeps the recommendation contract:
// reasons shown, Hide / Not for me feedback, clicks + impressions tracked.

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { track } from '@/lib/track';
import { GenreArt } from '@/components/GenreArt';
import type { RecCardData } from '@/components/v2c/RecShelf';

const FEEDBACK_REASONS: { key: string; label: string }[] = [
  { key: 'wrong_music', label: 'Wrong music' },
  { key: 'too_far', label: 'Too far' },
  { key: 'bad_date', label: 'Bad date' },
  { key: 'not_this_promoter', label: 'Not this promoter' },
  { key: 'other', label: 'Other' },
];

export function PicksHero({ events, title, surface }: {
  events: RecCardData[]; title: string; surface: string;
}) {
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [idx, setIdx] = useState(0);
  const [paused, setPaused] = useState(false);
  const [asking, setAsking] = useState(false);
  const stripRef = useRef<HTMLDivElement | null>(null);

  const visible = events.filter((e) => !hidden.has(e.id));
  const count = visible.length;
  const cur = count ? Math.min(idx, count - 1) : 0;
  const active = visible[cur];

  const goTo = useCallback((i: number, byHand = false) => {
    setIdx(i);
    setAsking(false);
    if (byHand) setPaused(true); // a person choosing beats the auto-rotate
  }, []);

  // Gentle auto-rotate until the visitor takes over.
  useEffect(() => {
    if (paused || asking || count < 2) return;
    const t = setInterval(() => setIdx((i) => (i + 1) % count), 6000);
    return () => clearInterval(t);
  }, [paused, asking, count]);

  // Keep the featured flyer in view as the strip rotates.
  useEffect(() => {
    const strip = stripRef.current;
    const el = strip?.children[cur] as HTMLElement | undefined;
    if (!strip || !el) return;
    strip.scrollTo({
      left: el.offsetLeft - (strip.clientWidth - el.clientWidth) / 2,
      behavior: 'smooth',
    });
  }, [cur, count]);

  async function hide(eventId: string, reason?: string) {
    setAsking(false);
    setHidden((prev) => new Set(prev).add(eventId));
    await fetch(`/api/events/${eventId}/feedback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(reason ? { kind: 'not_for_me', reason } : { kind: 'hide' }),
    }).catch(() => {});
  }

  if (!count || !active) return null;

  return (
    <section
      className="picksHero"
      aria-label={title}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      {active.primary_image_url && (
        // eslint-disable-next-line @next/next/no-img-element
        <img className="picksHeroBg" src={active.primary_image_url} alt="" aria-hidden />
      )}
      <div className="picksHeroInner">
        <div className="picksHeroTop">
          <span className="picksHeroKicker">{title}</span>
          {count > 1 && (
            <span className="picksHeroNav">
              <button type="button" className="picksArrow" aria-label="Previous pick"
                      onClick={() => goTo((cur - 1 + count) % count, true)}>‹</button>
              <span className="picksHeroCount">{cur + 1} / {count}</span>
              <button type="button" className="picksArrow" aria-label="Next pick"
                      onClick={() => goTo((cur + 1) % count, true)}>›</button>
            </span>
          )}
        </div>

        <div className="picksStrip" ref={stripRef}>
          {visible.map((e, i) => (
            <button
              key={e.id}
              type="button"
              className={`picksTile${i === cur ? ' active' : ''}`}
              aria-label={e.title}
              aria-current={i === cur}
              onClick={() => goTo(i, true)}
            >
              {e.primary_image_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={e.primary_image_url} alt="" loading="lazy" />
              ) : (
                <span className="picksTileArt"><GenreArt genres={e.genres} compact /></span>
              )}
            </button>
          ))}
        </div>

        <div className="picksHeroFoot">
          <div className="picksHeroInfo">
            <Link
              href={`/events/${active.slug}`}
              className="picksHeroTitle"
              onClick={() => track('recommendation_click', { eventId: active.id, surface })}
            >
              {active.title}
            </Link>
            <div className="picksHeroMeta">
              {active.when}
              {active.venue_name && ` · ${active.venue_name}`}
              {active.city && ` · ${active.city}`}
              {active.price && ` · ${active.price}`}
            </div>
            {active.reasons.length > 0 && (
              <div className="picksHeroReasons">
                {active.reasons.map((r, i) => <span className="recReason" key={i}>{r}</span>)}
              </div>
            )}
          </div>
          <div className="picksHeroActions">
            <Link
              href={`/events/${active.slug}`}
              className="picksBtn solid"
              onClick={() => track('recommendation_click', { eventId: active.id, surface })}
            >
              Guest list
            </Link>
            <a className="picksBtn outline" href={`/out/${active.id}`} target="_blank" rel="noopener">
              Tickets
            </a>
          </div>
        </div>

        <div className="picksHeroFeedback">
          {asking ? (
            <>
              {FEEDBACK_REASONS.map((r) => (
                <button key={r.key} className="chip" type="button" onClick={() => hide(active.id, r.key)}>
                  {r.label}
                </button>
              ))}
              <button className="chip" type="button" onClick={() => setAsking(false)}>Cancel</button>
            </>
          ) : (
            <>
              <button className="picksHide" type="button" onClick={() => hide(active.id)}>Hide</button>
              <button className="picksHide" type="button" onClick={() => setAsking(true)}>Not for me</button>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
