// Promoter profile editing (admin+). Identity-sensitive changes (name,
// official website) are audited with before/after values so admins can
// trace material changes; cosmetic fields update freely.

import { NextRequest, NextResponse } from 'next/server';
import { AuthError } from '@/lib/auth';
import { query, queryOne } from '@/lib/db';
import { requirePromoterRole } from '@/lib/promoterAuth';
import { audit } from '@/lib/audit';

function sanitizeHttpUrl(raw: unknown): string | null {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  try {
    const u = new URL(raw.trim());
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.toString() : null;
  } catch {
    return null;
  }
}

const SOCIAL_KEYS = ['instagram', 'soundcloud', 'facebook', 'mixcloud', 'bandcamp', 'x'];

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const { member, promoter } = await requirePromoterRole(id, 'admin');
    const body = await req.json().catch(() => ({}));

    const before = await queryOne<{ name: string; website: string | null }>(
      `select name, website from promoters where id = $1`, [id]
    );

    const sets: string[] = [];
    const args: unknown[] = [];
    const set = (col: string, val: unknown) => {
      args.push(val);
      sets.push(`${col} = $${args.length}`);
    };

    if (typeof body.description === 'string') set('description', body.description.trim().slice(0, 2000) || null);
    if (typeof body.city === 'string') set('city', body.city.trim().slice(0, 100) || null);
    if (typeof body.country === 'string') set('country', body.country.trim().slice(0, 100) || null);
    if ('imageUrl' in body) set('image_url', sanitizeHttpUrl(body.imageUrl));
    if ('heroImageUrl' in body) set('hero_image_url', sanitizeHttpUrl(body.heroImageUrl));
    if ('website' in body) {
      const site = sanitizeHttpUrl(body.website);
      if (body.website && !site) return NextResponse.json({ error: 'Invalid website URL' }, { status: 400 });
      set('website', site);
    }
    if (typeof body.name === 'string' && body.name.trim()) set('name', body.name.trim().slice(0, 200));
    if (body.socials && typeof body.socials === 'object') {
      const socials: Record<string, string> = {};
      for (const key of SOCIAL_KEYS) {
        const v = sanitizeHttpUrl((body.socials as Record<string, unknown>)[key]);
        if (v) socials[key] = v;
      }
      set('socials', JSON.stringify(socials));
    }

    if (sets.length) {
      args.push(id);
      await query(`update promoters set ${sets.join(', ')}, updated_at = now() where id = $${args.length}`, args);
    }

    if (Array.isArray(body.genreSlugs)) {
      await query(`delete from promoter_genres where promoter_id = $1`, [id]);
      for (const slug of body.genreSlugs.slice(0, 12)) {
        await query(
          `insert into promoter_genres (promoter_id, genre_id)
           select $1, id from genres where slug = $2 on conflict do nothing`,
          [id, String(slug)]
        );
      }
    }

    const identityChanged =
      (typeof body.name === 'string' && body.name.trim() && body.name.trim() !== before?.name) ||
      ('website' in body && sanitizeHttpUrl(body.website) !== (before?.website ?? null));
    await audit('profile_changed', {
      actorId: member.id, promoterId: promoter.id,
      detail: {
        fields: Object.keys(body),
        ...(identityChanged ? { identity_change: { before, after: { name: body.name, website: body.website } } } : {}),
      },
    });

    return NextResponse.json({ ok: true, identityChangeFlagged: !!identityChanged });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error(err);
    return NextResponse.json({ error: 'Something went wrong' }, { status: 500 });
  }
}
