// CLAIM THIS PROFILE: a signed-in member asserts they run this promoter.
// Domain evidence (claimant email domain == promoter website domain) is
// recorded but never auto-approves — admin decides. A rejected claimant
// cannot silently overwrite promoter information (claims never write to the
// promoter row beyond the pending flag).

import { NextRequest, NextResponse } from 'next/server';
import { AuthError, requireMember } from '@/lib/auth';
import { query, queryOne } from '@/lib/db';
import { audit } from '@/lib/audit';
import { domainOf, emailDomain } from '@/lib/promoterAuth';

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const member = await requireMember();
    const { id } = await ctx.params;
    const body = await req.json().catch(() => ({}));

    const promoter = await queryOne<{ id: string; claim_status: string; website: string | null }>(
      `select id, claim_status, website from promoters where id = $1`,
      [id]
    );
    if (!promoter) return NextResponse.json({ error: 'Promoter not found' }, { status: 404 });
    if (promoter.claim_status === 'verified') {
      return NextResponse.json({ error: 'This promoter is already verified' }, { status: 409 });
    }
    if (promoter.claim_status === 'suspended') {
      return NextResponse.json({ error: 'This promoter is currently suspended' }, { status: 409 });
    }

    const name = String(body.name ?? '').trim();
    const email = String(body.email ?? '').trim().toLowerCase();
    const role = String(body.role ?? '').trim() || null;
    const phone = String(body.phone ?? '').trim() || null;
    const website = String(body.website ?? '').trim() || null;
    const notes = String(body.notes ?? '').trim() || null;
    if (!name) return NextResponse.json({ error: 'Your name is required' }, { status: 400 });
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      return NextResponse.json({ error: 'A valid email is required' }, { status: 400 });
    }

    const openClaim = await queryOne(
      `select 1 from promoter_claims
        where promoter_id = $1 and member_id = $2 and status in ('pending', 'info_requested')`,
      [id, member.id]
    );
    if (openClaim) {
      return NextResponse.json({ error: 'You already have a claim under review' }, { status: 409 });
    }

    // Domain evidence: claimant email vs the promoter's known website, or
    // the website they supplied when we have none on file.
    const officialDomain = domainOf(promoter.website) ?? domainOf(website);
    const match = !!officialDomain && emailDomain(email) === officialDomain;

    const claim = await queryOne<{ id: string }>(
      `insert into promoter_claims
         (promoter_id, member_id, claimant_name, claimant_role, email, phone, website, notes, domain_match)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning id`,
      [id, member.id, name, role, email, phone, website, notes, match]
    );
    await query(
      `update promoters set claim_status = 'claim_pending', updated_at = now()
        where id = $1 and claim_status in ('unclaimed', 'rejected')`,
      [id]
    );
    await audit('claim_submitted', {
      actorId: member.id, promoterId: id,
      detail: { claimId: claim!.id, domain_match: match },
    });

    return NextResponse.json({ ok: true, domainMatch: match }, { status: 201 });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error(err);
    return NextResponse.json({ error: 'Something went wrong' }, { status: 500 });
  }
}
