// Market desk — businesses in, businesses out. Admin chooses who appears.
//
//   create      add a business by hand (status pending, or invited with an owner email)
//   decide      approve / reject / pause / resume / invite
//   update      edit any listing field, featured, sort order, admin notes
//   add_member  give an account the portal for a business
//   offer       create / edit / approve / reject an offer on the business's behalf

import { NextRequest, NextResponse } from 'next/server';
import { AuthError, requireAdmin } from '@/lib/auth';
import { query, queryOne } from '@/lib/db';
import { audit } from '@/lib/audit';
import { track } from '@/lib/analytics';
import { refreshAdminReviewDigest } from '@/lib/adminNotify';
import { businessSets, offerSets, uniqueBusinessSlug, type BusinessPatch, type OfferPatch } from '@/lib/market';
import { queueMemberTransactional } from '@/lib/email';
import { fillMissingBusinessImages } from '@/lib/marketImages';

// Best effort: a slow or broken website must never block the desk.
const fillImages = (id: string) => fillMissingBusinessImages(id).catch((err) => { console.error('market image discovery failed', err); return { hero: false, logo: false, error: String(err) }; });

const SITE = process.env.SITE_URL ?? 'https://www.guestlist.net';

async function tellOwners(businessId: string, decision: 'approved' | 'rejected' | 'paused', note: string | null) {
  const b = await queryOne<{ name: string; slug: string }>(`select name, slug from market_businesses where id = $1`, [businessId]);
  if (!b) return;
  const owners = await query<{ member_id: string; email: string }>(
    `select m.id as member_id, m.email from market_business_members bm join members m on m.id = bm.member_id where bm.business_id = $1`,
    [businessId]
  );
  const copy = decision === 'approved'
    ? { subject: `${b.name} is in Guestlist Market`, body: 'Your listing is live to Guestlist members. Keep your offer fresh from your business portal.', cta: 'OPEN YOUR PORTAL', url: `${SITE}/business` }
    : decision === 'rejected'
      ? { subject: `About ${b.name} and Guestlist Market`, body: note ? `The Guestlist team looked at your application: ${note}` : 'The Guestlist team couldn’t bring your business into the Market this time.', cta: 'GUESTLIST MARKET', url: `${SITE}/market` }
      : { subject: `${b.name} is paused in Guestlist Market`, body: note ?? 'Your listing is hidden from members for now. Contact us if you think that’s a mistake.', cta: 'OPEN YOUR PORTAL', url: `${SITE}/business` };
  for (const o of owners) {
    await query(
      `insert into notifications (member_id, type, payload) values ($1, 'market_application_update', $2)`,
      [o.member_id, { business_id: businessId, name: b.name, slug: b.slug, decision }]
    ).catch(() => null);
    await queueMemberTransactional({
      memberId: o.member_id, email: o.email, emailType: 'notification:market_decision',
      subject: copy.subject, body: copy.body, ctaLabel: copy.cta, ctaUrl: copy.url,
      dedupeKey: `market:${businessId}:${decision}:${o.member_id}`,
    });
  }
}

export async function POST(req: NextRequest) {
  try {
    const admin = await requireAdmin();
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const action = String(body.action ?? '');
    const note = typeof body.note === 'string' ? body.note.trim().slice(0, 1000) || null : null;

    if (action === 'create') {
      const patch = (body.business ?? {}) as BusinessPatch;
      const name = (patch.name ?? '').trim();
      if (name.length < 2) return NextResponse.json({ error: 'Business needs a name' }, { status: 400 });
      const slug = await uniqueBusinessSlug(name);
      const ownerEmail = typeof body.ownerEmail === 'string' ? body.ownerEmail.trim().toLowerCase() : '';
      const owner = ownerEmail ? await queryOne<{ id: string }>(`select id from members where lower(email) = $1`, [ownerEmail]) : null;
      if (ownerEmail && !owner) return NextResponse.json({ error: 'No Guestlist account with that email — they need to sign up first' }, { status: 404 });
      const status = body.approve ? 'approved' : owner ? 'invited' : 'pending';
      const row = await queryOne<{ id: string }>(
        `insert into market_businesses (name, slug, status, created_by_member_id, approved_at, approved_by_member_id)
         values ($1, $2, $3::text, $4::uuid, case when $3::text = 'approved' then now() end, case when $3::text = 'approved' then $4::uuid end) returning id`,
        [name, slug, status, admin.id]
      );
      const { sets, args } = businessSets({ ...patch, name });
      if (sets.length) {
        args.push(row!.id);
        await query(`update market_businesses set ${sets.join(', ')}, updated_at = now() where id = $${args.length}`, args);
      }
      if (owner) {
        await query(`insert into market_business_members (business_id, member_id, role) values ($1, $2, 'owner') on conflict do nothing`, [row!.id, owner.id]);
      }
      await audit('market_business_created', { actorId: admin.id, detail: { businessId: row!.id, status, via: 'admin' } });
      const images = await fillImages(row!.id);
      return NextResponse.json({ ok: true, id: row!.id, slug, images });
    }

    const businessId = typeof body.businessId === 'string' ? body.businessId : '';
    const business = businessId ? await queryOne<{ id: string; status: string; name: string }>(`select id, status, name from market_businesses where id = $1`, [businessId]) : null;
    if (!business) return NextResponse.json({ error: 'Business not found' }, { status: 404 });

    if (action === 'decide') {
      const decision = String(body.decision ?? '');
      const next = decision === 'approve' ? 'approved' : decision === 'reject' ? 'rejected'
        : decision === 'pause' ? 'paused' : decision === 'resume' ? 'approved' : decision === 'invite' ? 'invited' : null;
      if (!next) return NextResponse.json({ error: 'Unknown decision' }, { status: 400 });
      await query(
        `update market_businesses set status = $2, admin_notes = coalesce($3, admin_notes),
                approved_at = case when $2 = 'approved' then coalesce(approved_at, now()) else approved_at end,
                approved_by_member_id = case when $2 = 'approved' then coalesce(approved_by_member_id, $4) else approved_by_member_id end,
                updated_at = now()
          where id = $1`,
        [businessId, next, note, admin.id]
      );
      if (decision === 'approve') {
        // Approving the business approves offers it applied with, so the
        // listing is not empty on day one — and fills in the pictures it
        // is missing from its own website.
        await query(`update market_offers set approval_status = 'approved', updated_at = now() where business_id = $1 and approval_status = 'pending'`, [businessId]);
        await fillImages(businessId);
      }
      await audit('market_business_decided', { actorId: admin.id, detail: { businessId, decision, from: business.status, to: next, note } });
      await track('market_business_decided', { memberId: admin.id, metadata: { business_id: businessId, decision } });
      if (next === 'approved' && business.status !== 'approved' && business.status !== 'paused') await tellOwners(businessId, 'approved', note);
      if (next === 'rejected') await tellOwners(businessId, 'rejected', note);
      if (next === 'paused') await tellOwners(businessId, 'paused', note);
      await refreshAdminReviewDigest();
      return NextResponse.json({ ok: true, status: next });
    }

    if (action === 'update') {
      const patch = (body.business ?? {}) as BusinessPatch & { featured?: boolean; sortOrder?: number; adminNotes?: string };
      const { sets, args } = businessSets(patch);
      const set = (col: string, val: unknown) => { args.push(val); sets.push(`${col} = $${args.length}`); };
      if (typeof patch.featured === 'boolean') set('featured', patch.featured);
      if (Number.isInteger(Number(patch.sortOrder))) set('sort_order', Number(patch.sortOrder));
      if (typeof patch.adminNotes === 'string') set('admin_notes', patch.adminNotes.trim().slice(0, 4000) || null);
      if (sets.length) {
        args.push(businessId);
        await query(`update market_businesses set ${sets.join(', ')}, updated_at = now() where id = $${args.length}`, args);
      }
      await audit('market_business_updated', { actorId: admin.id, detail: { businessId, fields: Object.keys(patch), via: 'admin' } });
      const images = 'website' in patch ? await fillImages(businessId) : null;
      return NextResponse.json({ ok: true, images });
    }

    if (action === 'find_images') {
      const images = await fillImages(businessId);
      await audit('market_business_updated', { actorId: admin.id, detail: { businessId, findImages: images } });
      return NextResponse.json({ ok: true, images });
    }

    if (action === 'add_member') {
      const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
      const m = await queryOne<{ id: string }>(`select id from members where lower(email) = $1`, [email]);
      if (!m) return NextResponse.json({ error: 'No Guestlist account with that email' }, { status: 404 });
      const role = body.role === 'editor' ? 'editor' : 'owner';
      await query(
        `insert into market_business_members (business_id, member_id, role) values ($1, $2, $3)
         on conflict (business_id, member_id) do update set role = excluded.role`,
        [businessId, m.id, role]
      );
      await audit('market_business_updated', { actorId: admin.id, detail: { businessId, addedMember: m.id, role } });
      return NextResponse.json({ ok: true });
    }

    if (action === 'remove_member') {
      await query(`delete from market_business_members where business_id = $1 and member_id = $2`, [businessId, String(body.memberId)]);
      return NextResponse.json({ ok: true });
    }

    if (action === 'offer') {
      const patch = (body.offer ?? {}) as OfferPatch & { offerId?: string; approvalStatus?: string };
      let offerId = typeof patch.offerId === 'string' ? patch.offerId : null;
      if (!offerId) {
        if (!patch.title?.trim()) return NextResponse.json({ error: 'Give the offer a title' }, { status: 400 });
        const row = await queryOne<{ id: string }>(
          `insert into market_offers (business_id, title, approval_status, created_by_member_id) values ($1, $2, 'approved', $3) returning id`,
          [businessId, patch.title.trim().slice(0, 140), admin.id]
        );
        offerId = row!.id;
        await audit('market_offer_created', { actorId: admin.id, detail: { businessId, offerId, via: 'admin' } });
      } else {
        const exists = await queryOne(`select 1 from market_offers where id = $1 and business_id = $2`, [offerId, businessId]);
        if (!exists) return NextResponse.json({ error: 'Offer not found' }, { status: 404 });
      }
      const { sets, args } = offerSets(patch);
      if (patch.approvalStatus === 'approved' || patch.approvalStatus === 'rejected' || patch.approvalStatus === 'pending') {
        args.push(patch.approvalStatus);
        sets.push(`approval_status = $${args.length}`);
      }
      if (sets.length) {
        args.push(offerId);
        await query(`update market_offers set ${sets.join(', ')}, updated_at = now() where id = $${args.length}`, args);
      }
      await audit(patch.approvalStatus ? 'market_offer_decided' : 'market_offer_updated', { actorId: admin.id, detail: { businessId, offerId, fields: Object.keys(patch) } });
      await refreshAdminReviewDigest();
      return NextResponse.json({ ok: true, id: offerId });
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error(err);
    return NextResponse.json({ error: 'Something went wrong' }, { status: 500 });
  }
}
