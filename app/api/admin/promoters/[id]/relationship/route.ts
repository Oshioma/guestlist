// Promoter relationship desk: contacts, relationship state, standing
// allocation, and outreach not tied to a request. Extends the promoter
// record — there is no second promoter system.

import { NextRequest, NextResponse } from 'next/server';
import { AuthError, requireAdmin } from '@/lib/auth';
import { query, queryOne } from '@/lib/db';
import { audit } from '@/lib/audit';
import { track } from '@/lib/analytics';

const RELATIONSHIPS = ['none', 'contacted', 'responding', 'supplying', 'partner', 'declined'];
const CHANNELS = ['email', 'phone', 'whatsapp', 'instagram', 'in_person', 'other'];
const OUTCOMES = ['pending', 'free_places', 'discount', 'declined', 'no_response'];

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin();
    const { id } = await ctx.params;
    const promoter = await queryOne<{ id: string; name: string }>(`select id, name from promoters where id = $1`, [id]);
    if (!promoter) return NextResponse.json({ error: 'Promoter not found' }, { status: 404 });
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const action = String(body.action ?? '');
    const s = (v: unknown, max = 500) => (typeof v === 'string' ? v.trim().slice(0, max) || null : null);

    if (action === 'update') {
      const sets: string[] = [];
      const args: unknown[] = [];
      const set = (col: string, val: unknown) => { args.push(val); sets.push(`${col} = $${args.length}`); };
      if ('contactEmail' in body) set('contact_email', s(body.contactEmail, 254));
      if ('contactPhone' in body) set('contact_phone', s(body.contactPhone, 60));
      if (RELATIONSHIPS.includes(String(body.relationshipStatus))) set('relationship_status', body.relationshipStatus);
      if ('relationshipNotes' in body) set('relationship_notes', s(body.relationshipNotes, 4000));
      if ('standardAllocation' in body) {
        const v = s(body.standardAllocation, 300);
        set('standard_allocation', v);
        if (v) sets.push(`allocation_agreed_at = coalesce(allocation_agreed_at, now())`);
      }
      if ('allocationNotes' in body) set('allocation_notes', s(body.allocationNotes, 2000));
      if (sets.length) {
        args.push(id);
        await query(`update promoters set ${sets.join(', ')}, updated_at = now() where id = $${args.length}`, args);
      }
      await audit('promoter_relationship_changed', { actorId: admin.id, promoterId: id, detail: { fields: Object.keys(body) } });
      return NextResponse.json({ ok: true });
    }

    if (action === 'add_contact') {
      const name = s(body.name, 140);
      if (!name) return NextResponse.json({ error: 'Contact needs a name' }, { status: 400 });
      const row = await queryOne<{ id: string }>(
        `insert into promoter_contacts (promoter_id, name, role, email, phone, instagram, notes, is_primary, created_by_member_id)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9) returning id`,
        [id, name, s(body.role, 80), s(body.email, 254), s(body.phone, 60), s(body.instagram, 80), s(body.notes, 1000), !!body.isPrimary, admin.id]
      );
      await audit('promoter_contact_added', { actorId: admin.id, promoterId: id, detail: { contactId: row!.id } });
      return NextResponse.json({ ok: true, id: row!.id });
    }

    if (action === 'remove_contact') {
      await query(`delete from promoter_contacts where id = $1 and promoter_id = $2`, [String(body.contactId), id]);
      return NextResponse.json({ ok: true });
    }

    if (action === 'log_outreach') {
      const summary = s(body.summary, 2000);
      if (!summary) return NextResponse.json({ error: 'Say what was said' }, { status: 400 });
      const channel = CHANNELS.includes(String(body.channel)) ? String(body.channel) : 'email';
      const outcome = OUTCOMES.includes(String(body.outcome)) ? String(body.outcome) : 'pending';
      const places = Number.isInteger(Number(body.placesOffered)) && Number(body.placesOffered) >= 0 ? Number(body.placesOffered) : null;
      await query(
        `insert into promoter_outreach (promoter_id, actor_member_id, channel, direction, summary, outcome, places_offered)
         values ($1, $2, $3, $4, $5, $6, $7)`,
        [id, admin.id, channel, body.direction === 'inbound' ? 'inbound' : 'outbound', summary, outcome, places]
      );
      await query(
        `update promoters set relationship_status = case
           when relationship_status = 'partner' then 'partner'
           when $2 in ('free_places','discount') then 'supplying'
           when relationship_status = 'supplying' then 'supplying'
           when $2 = 'declined' then 'declined'
           when relationship_status = 'none' then 'contacted'
           else relationship_status end, updated_at = now()
         where id = $1`,
        [id, outcome]
      );
      await track('promoter_contacted', { memberId: admin.id, promoterId: id, metadata: { outcome, channel } });
      await audit('promoter_outreach_logged', { actorId: admin.id, promoterId: id, detail: { outcome, channel } });
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error(err);
    return NextResponse.json({ error: 'Something went wrong' }, { status: 500 });
  }
}
