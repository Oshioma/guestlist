import { NextRequest, NextResponse } from 'next/server';
import { getCurrentMember } from '@/lib/auth';
import { db } from '@/lib/db';
import { sendGuestlistConfirmed } from '@/lib/guestlistEmail';

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const member = await getCurrentMember();
  if (!member) return NextResponse.json({ error:'Sign in to request guestlist' }, { status:401 });
  // The segment is [id] to match the sibling event routes; Next refuses
  // two different slug names at the same path.
  const { id: eventId } = await ctx.params;
  const body = await req.json().catch(() => ({})) as Record<string, unknown>;
  const client = await db.connect();
  try {
    await client.query('begin');
    const settingsRes = await client.query<{
      promoter_id:string; mode:string; max_guestlist_places:number; guestlist_closes_at:string|null;
      max_plus_ones:number; updated_by_member_id:string|null;
    }>(`select promoter_id,mode,max_guestlist_places,guestlist_closes_at,max_plus_ones,updated_by_member_id
          from event_guestlist_settings where event_id=$1 for update`,[eventId]);
    const settings = settingsRes.rows[0];
    if (!settings || settings.mode === 'promoter_only') {
      await client.query('rollback');
      return NextResponse.json({ error:'Guestlist requests are not open for this event' }, { status:400 });
    }
    if (settings.guestlist_closes_at && new Date(settings.guestlist_closes_at).getTime() <= Date.now()) {
      await client.query('rollback');
      return NextResponse.json({ error:'The guestlist has closed' }, { status:400 });
    }
    const existing = await client.query(`select id,status from event_guestlist_entries where event_id=$1 and member_id=$2 and status in ('pending','confirmed')`,[eventId,member.id]);
    if (existing.rows[0]) {
      await client.query('rollback');
      return NextResponse.json({ error:'You already have a guestlist request for this event' }, { status:409 });
    }
    const plusOnes = Math.max(0,Math.min(settings.max_plus_ones,Number.isInteger(Number(body.plusOnes))?Number(body.plusOnes):0));
    const requestedPlaces = 1 + plusOnes;
    if (settings.max_guestlist_places > 0) {
      const usedRes = await client.query<{used:number}>(`select coalesce(sum(1+plus_ones),0)::int as used
        from event_guestlist_entries where event_id=$1 and source='guestlist' and status in ('pending','confirmed')`,[eventId]);
      if ((usedRes.rows[0]?.used ?? 0) + requestedPlaces > settings.max_guestlist_places) {
        await client.query('rollback');
        return NextResponse.json({ error:'Guestlist allocation is full' }, { status:400 });
      }
    }
    const status = settings.mode === 'auto_fill' ? 'confirmed' : 'pending';
    const name = (member.display_name || member.email.split('@')[0]).trim().slice(0,140);
    // On auto-fill nobody presses a button, but somebody still decided: the
    // person who set the guestlist to fill itself. That is the honest answer
    // to "who here confirmed this", so it is the one the pass carries.
    const entry = await client.query<{id:string}>(
      `insert into event_guestlist_entries(event_id,promoter_id,member_id,guest_name,plus_ones,source,status,created_by_member_id,confirmed_by_member_id,confirmed_at)
       values($1,$2,$3,$4,$5,'guestlist',$6,$3,$7,case when $6='confirmed' then now() else null end)
       returning id`,
      [eventId,settings.promoter_id,member.id,name,plusOnes,status,
       status === 'confirmed' ? settings.updated_by_member_id : null]);
    await client.query('commit');
    const entryId = entry.rows[0]?.id;
    if (status === 'confirmed' && entryId) {
      await sendGuestlistConfirmed(entryId).catch((err) => console.error('guestlist email failed', err));
    }
    return NextResponse.json({ ok:true, status });
  } catch (err) {
    await client.query('rollback').catch(()=>{});
    console.error(err);
    return NextResponse.json({ error:'Could not request guestlist' }, { status:500 });
  } finally {
    client.release();
  }
}
