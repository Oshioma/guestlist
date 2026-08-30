// Admin claim decisions: APPROVE / REJECT / REQUEST MORE INFORMATION —
// plus SUSPEND/UNSUSPEND of the promoter account itself.

import { NextRequest, NextResponse } from 'next/server';
import { AuthError, requireAdmin } from '@/lib/auth';
import { query, queryOne } from '@/lib/db';
import { audit, notifyPromoter } from '@/lib/audit';
import { queueMemberTransactional } from '@/lib/email';

const SITE = process.env.SITE_URL ?? 'https://www.clubguestlists.com';

// Claim decisions go straight to the claimant (there may be no promoter
// team yet at this point).
async function emailClaimant(
  memberId: string, claimId: string, promoterId: string,
  decision: 'approved' | 'rejected' | 'info_requested', note: string | null
) {
  const claimant = await queryOne<{ email: string }>(
    `select email from members where id = $1`, [memberId]);
  const promoter = await queryOne<{ name: string; slug: string }>(
    `select name, slug from promoters where id = $1`, [promoterId]);
  if (!claimant || !promoter) return;
  const spec = decision === 'approved'
    ? { subject: `Your claim for ${promoter.name} was approved`,
        body: `You now manage ${promoter.name} on Guestlist. Connect your website and your events stay current automatically.`,
        cta: 'OPEN YOUR DASHBOARD', url: `${SITE}/promoter` }
    : decision === 'rejected'
      ? { subject: `Your claim for ${promoter.name} wasn't approved`,
          body: note ? `The Guestlist team reviewed your claim: ${note}` : 'The Guestlist team reviewed your claim and couldn’t verify it this time. You can submit a new claim with more evidence.',
          cta: 'VIEW PROMOTER PAGE', url: `${SITE}/promoters/${promoter.slug}` }
      : { subject: `More information needed for your ${promoter.name} claim`,
          body: note ? `The Guestlist team needs a little more from you: ${note}` : 'The Guestlist team needs a little more information to verify your claim.',
          cta: 'UPDATE YOUR CLAIM', url: `${SITE}/promoters/${promoter.slug}/claim` };
  await queueMemberTransactional({
    memberId,
    email: claimant.email,
    emailType: 'claim_decision',
    subject: spec.subject,
    body: spec.body,
    ctaLabel: spec.cta,
    ctaUrl: spec.url,
    dedupeKey: `claim:${claimId}:${decision}`,
  });
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin();
    const { id } = await ctx.params;
    const body = await req.json().catch(() => ({}));
    const action = String(body.action ?? '');
    const note = String(body.note ?? '').trim() || null;

    const claim = await queryOne<{
      id: string; promoter_id: string; member_id: string; status: string; claimant_name: string;
    }>(`select id, promoter_id, member_id, status, claimant_name from promoter_claims where id = $1`, [id]);
    if (!claim) return NextResponse.json({ error: 'Claim not found' }, { status: 404 });

    if (action === 'approve') {
      if (claim.status === 'approved') return NextResponse.json({ ok: true });
      await query(
        `update promoter_claims set status = 'approved', admin_note = $2, decided_by = $3, decided_at = now()
          where id = $1`,
        [id, note, admin.id]
      );
      await query(
        `update promoters set claim_status = 'verified', verified = true, updated_at = now() where id = $1`,
        [claim.promoter_id]
      );
      await query(
        `insert into promoter_members (promoter_id, member_id, role) values ($1, $2, 'owner')
         on conflict (promoter_id, member_id) do update set role = 'owner'`,
        [claim.promoter_id, claim.member_id]
      );
      // Other open claims on the same promoter are implicitly superseded.
      await query(
        `update promoter_claims set status = 'rejected', admin_note = coalesce(admin_note, 'Superseded by approved claim'),
                decided_by = $2, decided_at = now()
          where promoter_id = $1 and status in ('pending', 'info_requested') and id <> $3`,
        [claim.promoter_id, admin.id, id]
      );
      await audit('claim_approved', { actorId: admin.id, promoterId: claim.promoter_id, detail: { claimId: id } });
      await notifyPromoter(claim.promoter_id, 'claim_approved', { payload: { claimId: id } });
      await emailClaimant(claim.member_id, id, claim.promoter_id, 'approved', note);
      return NextResponse.json({ ok: true });
    }

    if (action === 'reject' || action === 'request_info') {
      const newStatus = action === 'reject' ? 'rejected' : 'info_requested';
      await query(
        `update promoter_claims set status = $2, admin_note = $3, decided_by = $4, decided_at = now() where id = $1`,
        [id, newStatus, note, admin.id]
      );
      if (action === 'reject') {
        // Only fall back to unclaimed when no other open claim remains.
        await query(
          `update promoters set claim_status = 'unclaimed', updated_at = now()
            where id = $1 and claim_status = 'claim_pending'
              and not exists (select 1 from promoter_claims
                               where promoter_id = $1 and status in ('pending', 'info_requested'))`,
          [claim.promoter_id]
        );
      }
      await audit(action === 'reject' ? 'claim_rejected' : 'claim_info_requested', {
        actorId: admin.id, promoterId: claim.promoter_id, detail: { claimId: id, note },
      });
      await emailClaimant(claim.member_id, id, claim.promoter_id,
        action === 'reject' ? 'rejected' : 'info_requested', note);
      return NextResponse.json({ ok: true });
    }

    if (action === 'suspend' || action === 'unsuspend') {
      await query(
        `update promoters set claim_status = $2, updated_at = now() where id = $1`,
        [claim.promoter_id, action === 'suspend' ? 'suspended' : 'verified']
      );
      await audit(action === 'suspend' ? 'promoter_suspended' : 'promoter_unsuspended', {
        actorId: admin.id, promoterId: claim.promoter_id, detail: { via: 'claim_review', note },
      });
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error(err);
    return NextResponse.json({ error: 'Something went wrong' }, { status: 500 });
  }
}
