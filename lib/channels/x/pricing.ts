// X API COST CATALOGUE — the single place unit prices live.
//
// X moved to pay-per-use pricing (prepaid credits) in February 2026.
// Rates below were verified against current public documentation in
// August 2026; pricing CAN change, so every value can be overridden at
// runtime through the system_settings key 'x_pricing' without a deploy.
//
//   post create ......... $0.015
//   post create w/ URL .. $0.20   (posts containing a link cost more)
//   post read ........... $0.005  (per post returned; mentions are reads)
//   user read ........... $0.010
//   owned-resource read . $0.001
//   media upload ........ $0.010  (estimate; charged as owned writes)

import { getSetting } from '../../settings';

export type XPricing = {
  post_create: number;
  post_create_link: number;
  post_read: number;
  user_read: number;
  owned_read: number;
  media_upload: number;
};

export const X_PRICING_DEFAULTS: XPricing = {
  post_create: 0.015,
  post_create_link: 0.2,
  post_read: 0.005,
  user_read: 0.01,
  owned_read: 0.001,
  media_upload: 0.01,
};

export async function xPricing(): Promise<XPricing> {
  const stored = await getSetting<Partial<XPricing>>('x_pricing');
  const out = { ...X_PRICING_DEFAULTS };
  for (const k of Object.keys(out) as (keyof XPricing)[]) {
    const v = stored?.[k];
    if (typeof v === 'number' && Number.isFinite(v) && v >= 0) out[k] = v;
  }
  return out;
}

// Estimated cost of publishing one draft: create (link posts cost more on
// current X pricing) plus any media uploads.
export async function estimatePostCost(opts: { hasLink: boolean; mediaCount: number }): Promise<number> {
  const p = await xPricing();
  return (opts.hasLink ? p.post_create_link : p.post_create) + opts.mediaCount * p.media_upload;
}

export async function estimateMentionSyncCost(maxResults: number): Promise<number> {
  const p = await xPricing();
  return maxResults * p.post_read;
}
