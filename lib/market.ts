// GUESTLIST MARKET — independent businesses we like, giving members
// something extra. Curated, not crawled: nobody appears until Guestlist
// approves them. Offers are typed (a percentage is one kind among seven);
// claiming one mints a single-use code that expires, so there is never a
// permanent public code to copy and share.

import { randomBytes } from 'node:crypto';
import { AuthError } from './auth';
import { db, query, queryOne } from './db';
import { track } from './analytics';
import { audit } from './audit';
import { refreshAdminReviewDigest } from './adminNotify';
import { slugify } from './util';
import { formatPence } from './membership';

export const BUSINESS_STATUSES = ['invited', 'applied', 'pending', 'approved', 'rejected', 'paused'] as const;
export type BusinessStatus = (typeof BUSINESS_STATUSES)[number];

export const OFFER_TYPES = [
  ['percentage', 'Percentage off'],
  ['fixed', 'Fixed amount off'],
  ['free_item', 'Free item'],
  ['free_upgrade', 'Free upgrade'],
  ['package', 'Special package'],
  ['member_only', 'Member-only product or service'],
  ['other', 'Something else'],
] as const;
export type OfferType = (typeof OFFER_TYPES)[number][0];

export const REDEMPTION_METHODS = [
  ['code', 'Single-use code on the member’s phone'],
  ['show_membership', 'Show Guestlist membership'],
  ['online_code', 'Online code'],
  ['qr', 'QR code'],
  ['other', 'Other'],
] as const;

export const SOCIAL_KEYS = ['instagram', 'tiktok', 'facebook', 'x', 'website2'] as const;

export function sanitizeHttpUrl(raw: unknown): string | null {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  try {
    const u = new URL(raw.trim().includes('://') ? raw.trim() : `https://${raw.trim()}`);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.toString() : null;
  } catch {
    return null;
  }
}

export type Category = { id: string; name: string; slug: string };

export type Offer = {
  id: string;
  business_id: string;
  title: string;
  offer_type: OfferType;
  discount_percent: number | null;
  discount_amount_pence: number | null;
  currency: string;
  description: string | null;
  redemption_instructions: string | null;
  terms: string | null;
  redemption_method: string;
  claim_validity_minutes: number;
  valid_from: string | null;
  valid_to: string | null;
  active: boolean;
  approval_status: 'pending' | 'approved' | 'rejected';
};

export type Business = {
  id: string;
  name: string;
  slug: string;
  tagline: string | null;
  description: string | null;
  logo_url: string | null;
  hero_image_url: string | null;
  category_id: string | null;
  category_name: string | null;
  category_slug: string | null;
  city: string | null;
  country: string | null;
  address: string | null;
  website: string | null;
  socials: Record<string, string>;
  status: BusinessStatus;
  featured: boolean;
  sort_order: number;
};

export const OFFER_COLUMNS = `o.id, o.business_id, o.title, o.offer_type, o.discount_percent, o.discount_amount_pence,
  o.currency, o.description, o.redemption_instructions, o.terms, o.redemption_method, o.claim_validity_minutes,
  o.valid_from::text, o.valid_to::text, o.active, o.approval_status`;

const BUSINESS_COLUMNS = `b.id, b.name, b.slug, b.tagline, b.description, b.logo_url, b.hero_image_url,
  b.category_id, c.name as category_name, c.slug as category_slug, b.city, b.country, b.address,
  b.website, b.socials, b.status, b.featured, b.sort_order`;

// "15% OFF FOR GUESTLIST MEMBERS" — the line on the card.
export function offerHeadline(o: Pick<Offer, 'title' | 'offer_type' | 'discount_percent' | 'discount_amount_pence' | 'currency'>): string {
  if (o.offer_type === 'percentage' && o.discount_percent) return `${o.discount_percent}% OFF FOR GUESTLIST MEMBERS`;
  if (o.offer_type === 'fixed' && o.discount_amount_pence) return `${formatPence(o.discount_amount_pence, o.currency)} OFF FOR GUESTLIST MEMBERS`;
  return o.title.toUpperCase();
}

export function offerTypeLabel(t: string): string {
  return OFFER_TYPES.find(([k]) => k === t)?.[1] ?? t;
}

// Live = the business is in the Market, the offer is approved, switched on
// and inside its dates.
export const OFFER_LIVE_SQL = `o.active and o.approval_status = 'approved'
  and (o.valid_from is null or o.valid_from <= now()) and (o.valid_to is null or o.valid_to > now())`;

export async function listCategories(): Promise<Category[]> {
  return query<Category>(`select id, name, slug from market_categories where active order by sort_order, name`);
}

export type BusinessCard = Business & { offer: Offer | null };

export async function listApprovedBusinesses(opts: { categorySlug?: string | null; featuredOnly?: boolean; limit?: number } = {}): Promise<BusinessCard[]> {
  const rows = await query<Business & { offer: Offer | null }>(
    `select ${BUSINESS_COLUMNS},
            (select row_to_json(x) from (
               select ${OFFER_COLUMNS} from market_offers o
                where o.business_id = b.id and ${OFFER_LIVE_SQL}
                order by o.created_at limit 1) x) as offer
       from market_businesses b
       left join market_categories c on c.id = b.category_id
      where b.status = 'approved'
        and ($1::text is null or c.slug = $1)
        and (not $2 or b.featured)
      order by b.featured desc, b.sort_order, b.name
      limit $3`,
    [opts.categorySlug ?? null, !!opts.featuredOnly, opts.limit ?? 200]
  );
  return rows;
}

export async function getBusinessBySlug(slug: string, opts: { includeUnapproved?: boolean } = {}): Promise<(Business & { offers: Offer[] }) | null> {
  const b = await queryOne<Business>(
    `select ${BUSINESS_COLUMNS} from market_businesses b left join market_categories c on c.id = b.category_id
      where b.slug = $1 ${opts.includeUnapproved ? '' : `and b.status = 'approved'`}`,
    [slug]
  );
  if (!b) return null;
  const offers = await query<Offer>(
    `select ${OFFER_COLUMNS} from market_offers o where o.business_id = $1 and ${OFFER_LIVE_SQL} order by o.created_at`,
    [b.id]
  );
  return { ...b, offers };
}

export async function getBusinessById(id: string): Promise<(Business & { offers: Offer[] }) | null> {
  const b = await queryOne<Business>(
    `select ${BUSINESS_COLUMNS} from market_businesses b left join market_categories c on c.id = b.category_id where b.id = $1`,
    [id]
  );
  if (!b) return null;
  const offers = await query<Offer>(
    `select ${OFFER_COLUMNS} from market_offers o where o.business_id = $1 order by o.created_at desc`, [b.id]);
  return { ...b, offers };
}

export async function uniqueBusinessSlug(name: string): Promise<string> {
  const base = slugify(name) || 'business';
  let slug = base;
  for (let i = 2; i < 50; i++) {
    const taken = await queryOne(`select 1 from market_businesses where slug = $1`, [slug]);
    if (!taken) return slug;
    slug = `${base}-${i}`;
  }
  return `${base}-${randomBytes(3).toString('hex')}`;
}

// --- Business fields (shared by admin and the portal) ----------------------------------

export type BusinessPatch = {
  name?: string; tagline?: string; description?: string; logoUrl?: string; heroImageUrl?: string;
  categoryId?: string | null; city?: string; country?: string; address?: string; website?: string;
  socials?: Record<string, string>; contactName?: string; contactEmail?: string;
};

export function businessSets(body: BusinessPatch): { sets: string[]; args: unknown[] } {
  const sets: string[] = [];
  const args: unknown[] = [];
  const set = (col: string, val: unknown) => { args.push(val); sets.push(`${col} = $${args.length}`); };
  if (typeof body.name === 'string' && body.name.trim()) set('name', body.name.trim().slice(0, 200));
  if (typeof body.tagline === 'string') set('tagline', body.tagline.trim().slice(0, 160) || null);
  if (typeof body.description === 'string') set('description', body.description.trim().slice(0, 4000) || null);
  if ('logoUrl' in body) set('logo_url', sanitizeHttpUrl(body.logoUrl));
  if ('heroImageUrl' in body) set('hero_image_url', sanitizeHttpUrl(body.heroImageUrl));
  if ('categoryId' in body) set('category_id', body.categoryId && /^[0-9a-f-]{36}$/.test(body.categoryId) ? body.categoryId : null);
  if (typeof body.city === 'string') set('city', body.city.trim().slice(0, 100) || null);
  if (typeof body.country === 'string') set('country', body.country.trim().slice(0, 100) || null);
  if (typeof body.address === 'string') set('address', body.address.trim().slice(0, 300) || null);
  if ('website' in body) set('website', sanitizeHttpUrl(body.website));
  if (typeof body.contactName === 'string') set('contact_name', body.contactName.trim().slice(0, 140) || null);
  if (typeof body.contactEmail === 'string') set('contact_email', body.contactEmail.trim().slice(0, 254) || null);
  if (body.socials && typeof body.socials === 'object') {
    const socials: Record<string, string> = {};
    for (const key of SOCIAL_KEYS) {
      const v = sanitizeHttpUrl(body.socials[key]);
      if (v) socials[key] = v;
    }
    set('socials', JSON.stringify(socials));
  }
  return { sets, args };
}

export type OfferPatch = {
  title?: string; offerType?: string; discountPercent?: number | null; discountAmountPence?: number | null;
  currency?: string; description?: string; redemptionInstructions?: string; terms?: string;
  redemptionMethod?: string; claimValidityMinutes?: number; validFrom?: string | null; validTo?: string | null; active?: boolean;
};

export function offerSets(body: OfferPatch): { sets: string[]; args: unknown[] } {
  const sets: string[] = [];
  const args: unknown[] = [];
  const set = (col: string, val: unknown) => { args.push(val); sets.push(`${col} = $${args.length}`); };
  if (typeof body.title === 'string' && body.title.trim()) set('title', body.title.trim().slice(0, 140));
  if (OFFER_TYPES.some(([k]) => k === body.offerType)) set('offer_type', body.offerType);
  if ('discountPercent' in body) {
    const n = Number(body.discountPercent);
    set('discount_percent', Number.isInteger(n) && n >= 1 && n <= 100 ? n : null);
  }
  if ('discountAmountPence' in body) {
    const n = Number(body.discountAmountPence);
    set('discount_amount_pence', Number.isInteger(n) && n > 0 ? n : null);
  }
  if (typeof body.currency === 'string' && /^[A-Z]{3}$/.test(body.currency)) set('currency', body.currency);
  if (typeof body.description === 'string') set('description', body.description.trim().slice(0, 2000) || null);
  if (typeof body.redemptionInstructions === 'string') set('redemption_instructions', body.redemptionInstructions.trim().slice(0, 2000) || null);
  if (typeof body.terms === 'string') set('terms', body.terms.trim().slice(0, 4000) || null);
  if (REDEMPTION_METHODS.some(([k]) => k === body.redemptionMethod)) set('redemption_method', body.redemptionMethod);
  if ('claimValidityMinutes' in body) {
    const n = Number(body.claimValidityMinutes);
    if (Number.isInteger(n) && n >= 5 && n <= 43200) set('claim_validity_minutes', n);
  }
  const date = (v: unknown) => (typeof v === 'string' && v && !Number.isNaN(Date.parse(v)) ? new Date(v) : null);
  if ('validFrom' in body) set('valid_from', date(body.validFrom));
  if ('validTo' in body) set('valid_to', date(body.validTo));
  if (typeof body.active === 'boolean') set('active', body.active);
  return { sets, args };
}

// A business applying to join. Lands as 'applied' for admin to decide.
export async function applyToMarket(memberId: string, body: BusinessPatch): Promise<{ id: string; slug: string }> {
  const name = (body.name ?? '').trim();
  if (name.length < 2) throw new AuthError(400, 'Tell us the business name');
  const slug = await uniqueBusinessSlug(name);
  const { sets, args } = businessSets({ ...body, name });
  const client = await db.connect();
  try {
    await client.query('begin');
    const row = (await client.query<{ id: string }>(
      `insert into market_businesses (name, slug, status, created_by_member_id) values ($1, $2, 'applied', $3) returning id`,
      [name, slug, memberId]
    )).rows[0];
    if (sets.length) {
      args.push(row.id);
      await client.query(`update market_businesses set ${sets.join(', ')}, updated_at = now() where id = $${args.length}`, args);
    }
    await client.query(
      `insert into market_business_members (business_id, member_id, role) values ($1, $2, 'owner') on conflict do nothing`,
      [row.id, memberId]
    );
    await client.query('commit');
    await track('market_business_applied', { memberId, metadata: { business_id: row.id } });
    await audit('market_business_created', { actorId: memberId, detail: { businessId: row.id, via: 'application' } });
    await refreshAdminReviewDigest();
    return { id: row.id, slug };
  } catch (err) {
    await client.query('rollback').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

// --- Claims ------------------------------------------------------------------------------

// Readable on a phone, no ambiguous characters, 8 random symbols from a
// 32-letter alphabet (~40 bits). GL-XXXX-XXXX.
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export function mintClaimCode(): string {
  const bytes = randomBytes(8);
  let s = '';
  for (let i = 0; i < 8; i++) s += ALPHABET[bytes[i] % ALPHABET.length];
  return `GL-${s.slice(0, 4)}-${s.slice(4)}`;
}

export type Claim = {
  id: string; offer_id: string; business_id: string; member_id: string; code: string;
  status: 'claimed' | 'redeemed' | 'expired' | 'cancelled'; claimed_at: string; expires_at: string; redeemed_at: string | null;
};

export async function claimOffer(memberId: string, offerId: string): Promise<{ claim: Claim; reused: boolean }> {
  const offer = await queryOne<{ id: string; business_id: string; claim_validity_minutes: number; status: string; live: boolean }>(
    `select o.id, o.business_id, o.claim_validity_minutes, b.status, (${OFFER_LIVE_SQL}) as live
       from market_offers o join market_businesses b on b.id = o.business_id where o.id = $1`,
    [offerId]
  );
  if (!offer || offer.status !== 'approved' || !offer.live) throw new AuthError(400, 'This offer isn’t available right now');
  // One live code at a time: showing the same code twice is fine, minting
  // ten in a row is not.
  const existing = await queryOne<Claim>(
    `select id, offer_id, business_id, member_id, code, status, claimed_at::text, expires_at::text, redeemed_at::text
       from market_offer_claims where offer_id = $1 and member_id = $2 and status = 'claimed' and expires_at > now()
       order by claimed_at desc limit 1`,
    [offerId, memberId]
  );
  if (existing) return { claim: existing, reused: true };
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = mintClaimCode();
    const row = await queryOne<Claim>(
      `insert into market_offer_claims (offer_id, business_id, member_id, code, expires_at)
       values ($1, $2, $3, $4, now() + make_interval(mins => $5))
       on conflict (code) do nothing
       returning id, offer_id, business_id, member_id, code, status, claimed_at::text, expires_at::text, redeemed_at::text`,
      [offerId, offer.business_id, memberId, code, offer.claim_validity_minutes]
    );
    if (row) {
      await track('market_offer_claimed', { memberId, metadata: { offer_id: offerId, business_id: offer.business_id } });
      return { claim: row, reused: false };
    }
  }
  throw new Error('Could not mint a claim code');
}

export type ClaimView = Claim & {
  offer_title: string; offer_type: OfferType; discount_percent: number | null; discount_amount_pence: number | null;
  currency: string; redemption_instructions: string | null; terms: string | null; redemption_method: string;
  business_name: string; business_slug: string; logo_url: string | null; address: string | null; city: string | null;
};

// Ownership-checked: a claim id in a URL is not proof of anything.
export async function claimForMember(claimId: string, memberId: string): Promise<ClaimView | null> {
  return queryOne<ClaimView>(
    `select k.id, k.offer_id, k.business_id, k.member_id, k.code,
            case when k.status = 'claimed' and k.expires_at <= now() then 'expired' else k.status end as status,
            k.claimed_at::text, k.expires_at::text, k.redeemed_at::text,
            o.title as offer_title, o.offer_type, o.discount_percent, o.discount_amount_pence, o.currency,
            o.redemption_instructions, o.terms, o.redemption_method,
            b.name as business_name, b.slug as business_slug, b.logo_url, b.address, b.city
       from market_offer_claims k
       join market_offers o on o.id = k.offer_id
       join market_businesses b on b.id = k.business_id
      where k.id = $1 and k.member_id = $2`,
    [claimId, memberId]
  );
}

export async function memberClaims(memberId: string, limit = 20): Promise<ClaimView[]> {
  return query<ClaimView>(
    `select k.id, k.offer_id, k.business_id, k.member_id, k.code,
            case when k.status = 'claimed' and k.expires_at <= now() then 'expired' else k.status end as status,
            k.claimed_at::text, k.expires_at::text, k.redeemed_at::text,
            o.title as offer_title, o.offer_type, o.discount_percent, o.discount_amount_pence, o.currency,
            o.redemption_instructions, o.terms, o.redemption_method,
            b.name as business_name, b.slug as business_slug, b.logo_url, b.address, b.city
       from market_offer_claims k
       join market_offers o on o.id = k.offer_id
       join market_businesses b on b.id = k.business_id
      where k.member_id = $1 order by k.claimed_at desc limit $2`,
    [memberId, limit]
  );
}

export type RedeemOutcome =
  | { outcome: 'redeemed'; offer_title: string; member_name: string }
  | { outcome: 'not_found' | 'already_redeemed' | 'expired' | 'cancelled' };

export async function redeemClaim(businessId: string, rawCode: string, redeemerId: string, note?: string | null): Promise<RedeemOutcome> {
  const code = rawCode.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  const normalised = code.startsWith('GL') ? `GL-${code.slice(2, 6)}-${code.slice(6, 10)}` : `GL-${code.slice(0, 4)}-${code.slice(4, 8)}`;
  const k = await queryOne<{ id: string; status: string; expires_at: string; offer_title: string; member_name: string; member_id: string; offer_id: string }>(
    `select k.id, k.status, k.expires_at::text, o.title as offer_title, m.display_name as member_name, k.member_id, k.offer_id
       from market_offer_claims k join market_offers o on o.id = k.offer_id join members m on m.id = k.member_id
      where k.business_id = $1 and k.code = $2`,
    [businessId, normalised]
  );
  if (!k) return { outcome: 'not_found' };
  if (k.status === 'redeemed') return { outcome: 'already_redeemed' };
  if (k.status === 'cancelled') return { outcome: 'cancelled' };
  if (k.status === 'expired' || new Date(k.expires_at).getTime() <= Date.now()) {
    await query(`update market_offer_claims set status = 'expired' where id = $1 and status = 'claimed'`, [k.id]);
    return { outcome: 'expired' };
  }
  const updated = await query(
    `update market_offer_claims set status = 'redeemed', redeemed_at = now(), redeemed_by_member_id = $2, redemption_note = $3
      where id = $1 and status = 'claimed' returning id`,
    [k.id, redeemerId, note?.trim().slice(0, 300) || null]
  );
  if (!updated.length) return { outcome: 'already_redeemed' };
  await track('market_offer_redeemed', { memberId: k.member_id, metadata: { offer_id: k.offer_id, business_id: businessId, by: redeemerId } });
  await audit('market_offer_redeemed', { actorId: redeemerId, detail: { businessId, claimId: k.id } });
  return { outcome: 'redeemed', offer_title: k.offer_title, member_name: k.member_name };
}

// --- Stats a business can see ---------------------------------------------------------------

export type BusinessStats = {
  views_30d: number; claims_30d: number; redemptions_30d: number; claims_total: number; redemptions_total: number;
  unique_members: number; recent: { code_tail: string; offer_title: string; status: string; claimed_at: string; redeemed_at: string | null }[];
};

export async function businessStats(businessId: string): Promise<BusinessStats> {
  const [s, recent] = await Promise.all([
    queryOne<Omit<BusinessStats, 'recent'>>(
      `select
         (select count(*)::int from analytics_events a
           where a.event_type = 'market_business_viewed' and a.metadata->>'business_id' = $1::text
             and a.created_at > now() - interval '30 days') as views_30d,
         count(*) filter (where k.claimed_at > now() - interval '30 days')::int as claims_30d,
         count(*) filter (where k.status = 'redeemed' and k.redeemed_at > now() - interval '30 days')::int as redemptions_30d,
         count(*)::int as claims_total,
         count(*) filter (where k.status = 'redeemed')::int as redemptions_total,
         count(distinct k.member_id)::int as unique_members
       from market_offer_claims k where k.business_id = $1::uuid`,
      [businessId]
    ),
    // Codes are never listed in full — a partial is enough to reconcile.
    query<BusinessStats['recent'][number]>(
      `select right(k.code, 4) as code_tail, o.title as offer_title,
              case when k.status = 'claimed' and k.expires_at <= now() then 'expired' else k.status end as status,
              k.claimed_at::text, k.redeemed_at::text
         from market_offer_claims k join market_offers o on o.id = k.offer_id
        where k.business_id = $1 order by k.claimed_at desc limit 20`,
      [businessId]
    ),
  ]);
  return { ...(s ?? { views_30d: 0, claims_30d: 0, redemptions_30d: 0, claims_total: 0, redemptions_total: 0, unique_members: 0 }), recent };
}

// --- Admin listing ----------------------------------------------------------------------------

export type AdminBusinessRow = Business & {
  contact_name: string | null; contact_email: string | null; admin_notes: string | null; created_at: string;
  offers: number; live_offers: number; claims: number; redemptions: number; team: number;
};

export async function adminListBusinesses(): Promise<AdminBusinessRow[]> {
  return query<AdminBusinessRow>(
    `select ${BUSINESS_COLUMNS}, b.contact_name, b.contact_email, b.admin_notes, b.created_at::text,
            (select count(*)::int from market_offers o where o.business_id = b.id) as offers,
            (select count(*)::int from market_offers o where o.business_id = b.id and ${OFFER_LIVE_SQL}) as live_offers,
            (select count(*)::int from market_offer_claims k where k.business_id = b.id) as claims,
            (select count(*)::int from market_offer_claims k where k.business_id = b.id and k.status = 'redeemed') as redemptions,
            (select count(*)::int from market_business_members bm where bm.business_id = b.id) as team
       from market_businesses b left join market_categories c on c.id = b.category_id
      order by case b.status when 'applied' then 0 when 'pending' then 1 when 'approved' then 2 when 'paused' then 3 when 'invited' then 4 else 5 end,
               b.featured desc, b.sort_order, b.name`
  );
}
