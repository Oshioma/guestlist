// @GUESTLIST RIGHT NOW — the contextual website channel for the SAME
// intelligence opportunities that feed X. Only human-approved, published
// website-channel observations appear; no AI filler, and the module simply
// disappears when @guestlist has nothing to say.

import { query } from '@/lib/db';
import { optional } from '@/lib/resilient';
import { GuestlistNowItems } from '@/components/GuestlistNowItems';

export async function GuestlistNow({ city, isAdmin = false }: { city?: string | null; isAdmin?: boolean }) {
  type Observation = {
    id: string; body: string; link_url: string | null; posted_at: string;
    headline: string | null; opp_city: string | null;
  };
  // A band of commentary is never worth a broken homepage.
  const observations = await optional('GuestlistNow', () => query<Observation>(
    `select d.id, d.body, d.link_url, d.posted_at::text, o.headline, o.city as opp_city
       from channel_drafts d
       left join intelligence_opportunities o on o.id = d.opportunity_id
      where d.channel = 'website' and d.status = 'posted'
        and d.posted_at > now() - interval '48 hours'
        and ($1::text is null or o.city is null or lower(o.city) = lower($1))
        and not exists (
          select 1 from homepage_feed_suppressions s
           where s.source = 'website' and s.external_id = d.id::text
        )
      order by d.posted_at desc limit 3`,
    [city ?? null]
  ), []);
  if (!observations.length) return null;
  return <GuestlistNowItems observations={observations} isAdmin={isAdmin} />;
}
