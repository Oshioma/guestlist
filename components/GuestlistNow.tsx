// @GUESTLIST RIGHT NOW — the contextual website channel for the SAME
// intelligence opportunities that feed X. Only human-approved, published
// website-channel observations appear; no AI filler, and the module simply
// disappears when @guestlist has nothing to say.

import Link from 'next/link';
import { query } from '@/lib/db';

export async function GuestlistNow({ city }: { city?: string | null }) {
  const observations = await query<{
    id: string; body: string; link_url: string | null; posted_at: string;
    headline: string | null; opp_city: string | null;
  }>(
    `select d.id, d.body, d.link_url, d.posted_at::text, o.headline, o.city as opp_city
       from channel_drafts d
       left join intelligence_opportunities o on o.id = d.opportunity_id
      where d.channel = 'website' and d.status = 'posted'
        and d.posted_at > now() - interval '48 hours'
        and ($1::text is null or o.city is null or lower(o.city) = lower($1))
      order by d.posted_at desc limit 3`,
    [city ?? null]
  );
  if (!observations.length) return null;
  return (
    <section className="guestlistNow">
      <div className="guestlistNowHead">
        <span className="guestlistNowBadge">@guestlist</span>
        <span className="guestlistNowSub">The things we’re noticing</span>
      </div>
      {observations.map((o) => (
        <div className="guestlistNowItem" key={o.id}>
          <p style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{o.body}</p>
          {o.link_url && (
            <Link href={o.link_url.replace(/^https?:\/\/[^/]+/, '')} className="guestlistNowLink">
              On Guestlist →
            </Link>
          )}
        </div>
      ))}
    </section>
  );
}
