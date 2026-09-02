// Business portal: edit the listing. Editors can change copy and images;
// the name and website are identity, so a change to either is audited with
// before/after and flagged for the desk.

import { NextRequest, NextResponse } from 'next/server';
import { AuthError } from '@/lib/auth';
import { query, queryOne } from '@/lib/db';
import { requireBusinessRole } from '@/lib/marketAuth';
import { businessSets, sanitizeHttpUrl, type BusinessPatch } from '@/lib/market';
import { audit } from '@/lib/audit';
import { fillMissingBusinessImages } from '@/lib/marketImages';

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const { member, business } = await requireBusinessRole(id, 'editor', { allowUnapproved: true });
    const body = await req.json().catch(() => ({})) as BusinessPatch;
    const before = await queryOne<{ name: string; website: string | null }>(`select name, website from market_businesses where id = $1`, [id]);
    const { sets, args } = businessSets(body);
    if (sets.length) {
      args.push(id);
      await query(`update market_businesses set ${sets.join(', ')}, updated_at = now() where id = $${args.length}`, args);
    }
    const identityChanged =
      (typeof body.name === 'string' && body.name.trim() && body.name.trim() !== before?.name) ||
      ('website' in body && sanitizeHttpUrl(body.website) !== (before?.website ?? null));
    await audit('market_business_updated', {
      actorId: member.id,
      detail: {
        businessId: business.id, fields: Object.keys(body),
        ...(identityChanged ? { identity_change: { before, after: { name: body.name, website: body.website } } } : {}),
      },
    });
    // Pictures the owner left blank come from their own website, best effort.
    const images = 'website' in body || 'logoUrl' in body || 'heroImageUrl' in body
      ? await fillMissingBusinessImages(business.id).catch(() => ({ hero: false, logo: false, error: 'lookup failed' }))
      : null;
    return NextResponse.json({ ok: true, identityChangeFlagged: !!identityChanged, images });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error(err);
    return NextResponse.json({ error: 'Something went wrong' }, { status: 500 });
  }
}
