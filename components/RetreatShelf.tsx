'use client';

// RETREATS.
//
// The other half of Balance. The articles are the culture around the night;
// this is the week off it — somewhere with no line-up, no door, and nothing
// starting at one in the morning.
//
// Every card leaves the site, which is the honest shape for it: we are not
// taking a booking, we are pointing at one. So they open in a new tab, say
// where they go, and the click is recorded — the only way to know whether
// this section is worth its space on the page.

import { track } from '@/lib/track';

export type ShelfRetreat = {
  id: string;
  title: string;
  location: string | null;
  when_text: string | null;
  blurb: string | null;
  image_url: string | null;
  url: string;
  price_text: string | null;
};

function host(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; }
}

export function RetreatShelf({ retreats }: { retreats: ShelfRetreat[] }) {
  if (!retreats.length) return null;

  return (
    <section className="retreatShelf" aria-labelledby="retreats-heading">
      <div className="retreatShelfHead">
        <div>
          <div className="retreatShelfKicker">Balance</div>
          <h2 className="retreatShelfTitle" id="retreats-heading">Retreats.</h2>
        </div>
        <p className="retreatShelfLead">
          Places to go and do nothing in. Booked with them, not with us.
        </p>
      </div>

      {/* One retreat in a three-column grid is a card marooned in a third of a
          dark panel. So the shelf lays out for how many there actually are:
          one lies down across the width, two share it, three or more line up. */}
      <div className={`retreatGrid ${retreats.length === 1 ? 'one' : retreats.length === 2 ? 'two' : ''}`}>
        {retreats.map((r) => (
          <a
            key={r.id}
            className="retreatCard"
            href={r.url}
            target="_blank"
            rel="noopener noreferrer nofollow"
            onClick={() => track('retreat_clicked', { retreatId: r.id })}
          >
            <div className="retreatCardImg">
              {r.image_url
                ? <img src={r.image_url} alt="" loading="lazy" />
                : <span className="retreatCardNoImg" aria-hidden />}
              {r.when_text && <span className="retreatCardWhen">{r.when_text}</span>}
            </div>
            <div className="retreatCardBody">
              {r.location && <div className="retreatCardWhere">{r.location}</div>}
              <h3 className="retreatCardTitle">{r.title}</h3>
              {r.blurb && <p className="retreatCardBlurb">{r.blurb}</p>}
              <div className="retreatCardFoot">
                <span className="retreatCardPrice">{r.price_text ?? 'See dates and prices'}</span>
                {/* Says where you are about to end up. A card that leaves the
                    site without warning is a card that feels like a trick. */}
                <span className="retreatCardGo">{`${host(r.url)} \u2197`}</span>
              </div>
            </div>
          </a>
        ))}
      </div>
    </section>
  );
}
