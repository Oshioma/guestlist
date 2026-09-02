// Drops and good causes — written by people. Admin only, audited.

import { NextRequest, NextResponse } from 'next/server';
import { AuthError, requireAdmin } from '@/lib/auth';
import { query, queryOne } from '@/lib/db';
import { audit } from '@/lib/audit';
import { sanitizeHttpUrl } from '@/lib/market';
import { slugify } from '@/lib/util';

export async function POST(req: NextRequest) {
  try {
    const admin = await requireAdmin();
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const action = String(body.action ?? '');
    const s = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) || null : null);
    const date = (v: unknown) => (typeof v === 'string' && v && !Number.isNaN(Date.parse(v)) ? new Date(v) : null);

    if (action === 'save_drop') {
      const title = s(body.title, 160);
      if (!title) return NextResponse.json({ error: 'Give the drop a title' }, { status: 400 });
      const status = ['draft', 'live', 'closed'].includes(String(body.status)) ? String(body.status) : 'draft';
      const eventId = typeof body.eventId === 'string' && /^[0-9a-f-]{36}$/.test(body.eventId) ? body.eventId : null;
      if (eventId && !(await queryOne(`select 1 from events where id = $1`, [eventId]))) {
        return NextResponse.json({ error: 'That event id doesn’t exist' }, { status: 404 });
      }
      const places = Number.isInteger(Number(body.places)) && Number(body.places) >= 0 ? Number(body.places) : null;
      const args = [title, s(body.body, 4000), eventId, sanitizeHttpUrl(body.linkUrl), places, date(body.startsAt) ?? new Date(), date(body.endsAt), status, admin.id];
      const id = typeof body.id === 'string' ? body.id : null;
      const row = id
        ? await queryOne<{ id: string }>(
            `update member_drops set title = $1, body = $2, event_id = $3, link_url = $4, places = $5, starts_at = $6, ends_at = $7,
                    status = $8, updated_at = now() where id = $10 returning id`, [...args, id])
        : await queryOne<{ id: string }>(
            `insert into member_drops (title, body, event_id, link_url, places, starts_at, ends_at, status, created_by_member_id)
             values ($1, $2, $3, $4, $5, $6, $7, $8, $9) returning id`, args);
      await audit('member_drop_changed', { actorId: admin.id, detail: { dropId: row?.id, status } });
      return NextResponse.json({ ok: true, id: row?.id });
    }

    if (action === 'save_cause') {
      const title = s(body.title, 160);
      if (!title) return NextResponse.json({ error: 'Give the project a title' }, { status: 400 });
      const status = ['draft', 'live', 'completed', 'archived'].includes(String(body.status)) ? String(body.status) : 'draft';
      const id = typeof body.id === 'string' ? body.id : null;
      const args = [title, s(body.summary, 500), s(body.body, 8000), sanitizeHttpUrl(body.imageUrl), sanitizeHttpUrl(body.linkUrl), status,
        Number.isInteger(Number(body.sortOrder)) ? Number(body.sortOrder) : 0, admin.id];
      let row: { id: string } | null;
      if (id) {
        row = await queryOne<{ id: string }>(
          `update good_causes set title = $1, summary = $2, body = $3, image_url = $4, link_url = $5, status = $6, sort_order = $7,
                  updated_at = now() where id = $9 returning id`, [...args, id]);
      } else {
        let slug = slugify(title) || 'project';
        if (await queryOne(`select 1 from good_causes where slug = $1`, [slug])) slug = `${slug}-${Date.now().toString(36)}`;
        row = await queryOne<{ id: string }>(
          `insert into good_causes (title, summary, body, image_url, link_url, status, sort_order, created_by_member_id, slug)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9) returning id`, [...args, slug]);
      }
      await audit('good_cause_changed', { actorId: admin.id, detail: { causeId: row?.id, status } });
      return NextResponse.json({ ok: true, id: row?.id });
    }

    if (action === 'drop_claim') {
      const status = ['confirmed', 'declined', 'cancelled'].includes(String(body.status)) ? String(body.status) : null;
      if (!status) return NextResponse.json({ error: 'Unknown status' }, { status: 400 });
      await query(`update member_drop_claims set status = $2, note = coalesce($3, note) where id = $1`, [String(body.claimId), status, s(body.note, 500)]);
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error(err);
    return NextResponse.json({ error: 'Something went wrong' }, { status: 500 });
  }
}
