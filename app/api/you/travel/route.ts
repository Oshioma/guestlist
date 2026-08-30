// WHERE ARE YOU GOING? Travel plans give recommendations temporary
// relevance. Private by default — dates are never publicly exposed unless
// the member chooses; the recommendation engine may use private plans
// internally without revealing them.

import { NextRequest, NextResponse } from 'next/server';
import { AuthError, requireMember } from '@/lib/auth';
import { query, queryOne } from '@/lib/db';
import { findOrCreateCity, getLocation } from '@/lib/locations';
import { track } from '@/lib/analytics';

export async function GET() {
  try {
    const member = await requireMember();
    const plans = await query(
      `select tp.id, tp.start_date::text, tp.end_date::text, tp.visibility,
              l.id as location_id, l.name, l.slug, l.country_name
         from travel_plans tp join locations l on l.id = tp.location_id
        where tp.member_id = $1 and tp.end_date >= current_date
        order by tp.start_date`,
      [member.id]
    );
    return NextResponse.json({ plans });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error(err);
    return NextResponse.json({ error: 'Something went wrong' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const member = await requireMember();
    const body = await req.json().catch(() => ({}));

    let locationId = typeof body.locationId === 'string' ? body.locationId : null;
    if (!locationId && typeof body.destination === 'string' && body.destination.trim()) {
      const loc = await findOrCreateCity({
        name: body.destination.trim(),
        countryName: typeof body.country === 'string' ? body.country : null,
      });
      locationId = loc.id;
    }
    if (!locationId || !(await getLocation(locationId))) {
      return NextResponse.json({ error: 'Destination required' }, { status: 400 });
    }
    const start = String(body.startDate ?? '');
    const end = String(body.endDate ?? '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end) || end < start) {
      return NextResponse.json({ error: 'Valid dates required' }, { status: 400 });
    }
    const visibility = ['private', 'connections', 'public'].includes(body.visibility)
      ? body.visibility
      : 'private';
    const plan = await queryOne<{ id: string }>(
      `insert into travel_plans (member_id, location_id, start_date, end_date, visibility)
       values ($1, $2, $3, $4, $5) returning id`,
      [member.id, locationId, start, end, visibility]
    );
    await track('travel_plan_created', {
      memberId: member.id, metadata: { location_id: locationId, visibility },
    });
    return NextResponse.json({ ok: true, planId: plan!.id });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error(err);
    return NextResponse.json({ error: 'Something went wrong' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const member = await requireMember();
    const body = await req.json().catch(() => ({}));
    await query(`delete from travel_plans where id = $1 and member_id = $2`,
      [String(body.planId ?? ''), member.id]);
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error(err);
    return NextResponse.json({ error: 'Something went wrong' }, { status: 500 });
  }
}
