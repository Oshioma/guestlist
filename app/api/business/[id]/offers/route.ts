// Business portal: create and edit member offers. A new offer, or a change
// to what an offer IS (type, amount, terms), goes back to 'pending' for the
// desk; switching one on or off or moving its dates does not.

import { NextRequest, NextResponse } from 'next/server';
import { AuthError } from '@/lib/auth';
import { query, queryOne } from '@/lib/db';
import { requireBusinessRole } from '@/lib/marketAuth';
import { offerSets, type OfferPatch } from '@/lib/market';
import { audit } from '@/lib/audit';
import { refreshAdminReviewDigest } from '@/lib/adminNotify';

const NEEDS_REVIEW: (keyof OfferPatch)[] = ['title', 'offerType', 'discountPercent', 'discountAmountPence', 'description', 'terms', 'redemptionInstructions', 'redemptionMethod'];

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const { member } = await requireBusinessRole(id, 'editor', { allowUnapproved: true });
    const body = await req.json().catch(() => ({})) as OfferPatch;
    if (!body.title?.trim()) return NextResponse.json({ error: 'Give the offer a title' }, { status: 400 });
    const n = await queryOne<{ n: number }>(`select count(*)::int as n from market_offers where business_id = $1`, [id]);
    if ((n?.n ?? 0) >= 10) return NextResponse.json({ error: 'Ten offers is plenty — retire one first' }, { status: 400 });
    const row = await queryOne<{ id: string }>(
      `insert into market_offers (business_id, title, created_by_member_id) values ($1, $2, $3) returning id`,
      [id, body.title.trim().slice(0, 140), member.id]
    );
    const { sets, args } = offerSets(body);
    if (sets.length) {
      args.push(row!.id);
      await query(`update market_offers set ${sets.join(', ')}, updated_at = now() where id = $${args.length}`, args);
    }
    await audit('market_offer_created', { actorId: member.id, detail: { businessId: id, offerId: row!.id } });
    await refreshAdminReviewDigest();
    return NextResponse.json({ ok: true, id: row!.id });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error(err);
    return NextResponse.json({ error: 'Something went wrong' }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const { member } = await requireBusinessRole(id, 'editor', { allowUnapproved: true });
    const body = await req.json().catch(() => ({})) as OfferPatch & { offerId?: string };
    const offer = await queryOne<{ id: string; approval_status: string }>(
      `select id, approval_status from market_offers where id = $1 and business_id = $2`, [String(body.offerId), id]);
    if (!offer) return NextResponse.json({ error: 'Offer not found' }, { status: 404 });
    const { sets, args } = offerSets(body);
    const material = NEEDS_REVIEW.some((k) => k in body);
    if (material && offer.approval_status === 'approved') sets.push(`approval_status = 'pending'`);
    if (sets.length) {
      args.push(offer.id);
      await query(`update market_offers set ${sets.join(', ')}, updated_at = now() where id = $${args.length}`, args);
    }
    await audit('market_offer_updated', { actorId: member.id, detail: { businessId: id, offerId: offer.id, fields: Object.keys(body), backToReview: material } });
    if (material) await refreshAdminReviewDigest();
    return NextResponse.json({ ok: true, backToReview: material && offer.approval_status === 'approved' });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error(err);
    return NextResponse.json({ error: 'Something went wrong' }, { status: 500 });
  }
}
