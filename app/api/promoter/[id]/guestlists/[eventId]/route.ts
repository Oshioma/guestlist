import { NextRequest, NextResponse } from 'next/server';
import { AuthError } from '@/lib/auth';
import { db, query, queryOne } from '@/lib/db';
import { requireOwnEvent, requirePromoterRole } from '@/lib/promoterAuth';
import { markConfirmed } from '@/lib/doorPass';
import { sendGuestlistConfirmed } from '@/lib/guestlistEmail';

const SOURCES = new Set(['promoter','guestlist','artist','partner','competition','invite_link','member_referral']);
const MODES = new Set(['promoter_only','approve_requests','auto_fill']);

function cleanName(v: unknown) {
  return typeof v === 'string' ? v.trim().slice(0, 140) : '';
}
function cleanNotes(v: unknown) {
  return typeof v === 'string' && v.trim() ? v.trim().slice(0, 500) : null;
}
function int(v: unknown, min: number, max: number) {
  const n = Number(v);
  return Number.isInteger(n) ? Math.max(min, Math.min(max, n)) : min;
}
function fail(err: unknown) {
  if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.status });
  console.error(err);
  return NextResponse.json({ error: 'Something went wrong' }, { status: 500 });
}

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string; eventId: string }> }) {
  try {
    const { id, eventId } = await ctx.params;
    const { promoter } = await requirePromoterRole(id, 'analyst');
    await requireOwnEvent(promoter.id, eventId);
    const event = await queryOne<{id:string;title:string;start_at:string;timezone:string}>(
      `select id,title,start_at,timezone from events where id=$1`, [eventId]
    );
    const settings = await queryOne(
      `select mode,max_guestlist_places,guestlist_closes_at,max_plus_ones from event_guestlist_settings where event_id=$1`, [eventId]
    );
    const entries = await query(
      `select id,member_id,guest_name,plus_ones,source,status,notes,checked_in_at,created_at
         from event_guestlist_entries where event_id=$1 order by lower(guest_name),created_at`, [eventId]
    );
    return NextResponse.json({ event, settings: settings ?? { mode:'promoter_only', max_guestlist_places:0, guestlist_closes_at:null, max_plus_ones:1 }, entries });
  } catch (err) { return fail(err); }
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string; eventId: string }> }) {
  try {
    const { id, eventId } = await ctx.params;
    const { member, promoter } = await requirePromoterRole(id, 'editor');
    await requireOwnEvent(promoter.id, eventId);
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const action = String(body.action ?? '');

    if (action === 'settings') {
      const mode = MODES.has(String(body.mode)) ? String(body.mode) : 'promoter_only';
      const maxPlaces = int(body.maxGuestlistPlaces, 0, 100000);
      const maxPlusOnes = int(body.maxPlusOnes, 0, 10);
      const closes = typeof body.guestlistClosesAt === 'string' && body.guestlistClosesAt ? body.guestlistClosesAt : null;
      await query(
        `insert into event_guestlist_settings(event_id,promoter_id,mode,max_guestlist_places,guestlist_closes_at,max_plus_ones,updated_by_member_id)
         values($1,$2,$3,$4,$5,$6,$7)
         on conflict(event_id) do update set mode=excluded.mode,max_guestlist_places=excluded.max_guestlist_places,
           guestlist_closes_at=excluded.guestlist_closes_at,max_plus_ones=excluded.max_plus_ones,
           updated_by_member_id=excluded.updated_by_member_id,updated_at=now()`,
        [eventId,promoter.id,mode,maxPlaces,closes,maxPlusOnes,member.id]
      );
      return NextResponse.json({ ok:true });
    }

    if (action === 'add') {
      const name = cleanName(body.guestName);
      if (!name) return NextResponse.json({ error:'Guest name is required' }, { status:400 });
      const source = SOURCES.has(String(body.source)) ? String(body.source) : 'promoter';
      await query(
        `insert into event_guestlist_entries(event_id,promoter_id,guest_name,plus_ones,source,status,notes,created_by_member_id,confirmed_by_member_id,confirmed_at)
         values($1,$2,$3,$4,$5,'confirmed',$6,$7,$7,now())`,
        [eventId,promoter.id,name,int(body.plusOnes,0,10),source,cleanNotes(body.notes),member.id]
      );
      // A name typed in by hand has no member behind it, so there is nobody to
      // write to. sendGuestlistConfirmed knows that and says no.
      return NextResponse.json({ ok:true });
    }

    const entryId = typeof body.entryId === 'string' ? body.entryId : '';
    if (!entryId) return NextResponse.json({ error:'Entry is required' }, { status:400 });
    const entry = await queryOne<{id:string}>(`select id from event_guestlist_entries where id=$1 and event_id=$2 and promoter_id=$3`,[entryId,eventId,promoter.id]);
    if (!entry) return NextResponse.json({ error:'Guest not found' }, { status:404 });

    if (action === 'check_in') {
      await query(`update event_guestlist_entries set checked_in_at=case when checked_in_at is null then now() else null end,updated_at=now() where id=$1`,[entryId]);
    } else if (action === 'approve') {
      await query(`update event_guestlist_entries set status='confirmed',updated_at=now() where id=$1`,[entryId]);
      // WHO SAID YES is the fact the door pass carries, so it is recorded at
      // the moment somebody says it — not inferred afterwards.
      await markConfirmed(entryId, member.id);
      await sendGuestlistConfirmed(entryId).catch((err) => console.error('guestlist email failed', err));
    } else if (action === 'decline') {
      await query(`update event_guestlist_entries set status='declined',updated_at=now() where id=$1`,[entryId]);
    } else if (action === 'remove') {
      await query(`update event_guestlist_entries set status='cancelled',updated_at=now() where id=$1`,[entryId]);
    } else if (action === 'edit') {
      const name = cleanName(body.guestName);
      if (!name) return NextResponse.json({ error:'Guest name is required' }, { status:400 });
      const source = SOURCES.has(String(body.source)) ? String(body.source) : 'promoter';
      await query(`update event_guestlist_entries set guest_name=$2,plus_ones=$3,source=$4,notes=$5,updated_at=now() where id=$1`,[entryId,name,int(body.plusOnes,0,10),source,cleanNotes(body.notes)]);
    } else {
      return NextResponse.json({ error:'Unknown action' }, { status:400 });
    }
    return NextResponse.json({ ok:true });
  } catch (err) { return fail(err); }
}
