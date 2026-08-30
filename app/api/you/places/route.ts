// YOUR PLACES: home city + followed cities. Structured locations only —
// setting home or following a city resolves through the canonical location
// model (never duplicate "London"/"LONDON" places).

import { NextRequest, NextResponse } from 'next/server';
import { AuthError, requireMember } from '@/lib/auth';
import { query, queryOne } from '@/lib/db';
import { findOrCreateCity, getLocation, memberPlaces, searchLocations } from '@/lib/locations';
import { track } from '@/lib/analytics';

export async function GET(req: NextRequest) {
  try {
    const member = await requireMember();
    const q = req.nextUrl.searchParams.get('q');
    if (q != null) return NextResponse.json({ results: await searchLocations(q) });
    return NextResponse.json({ places: await memberPlaces(member.id) });
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
    const action = String(body.action ?? '');

    let locationId = typeof body.locationId === 'string' ? body.locationId : null;
    if (!locationId && body.newCity && typeof body.newCity === 'object') {
      const name = typeof body.newCity.name === 'string' ? body.newCity.name.trim() : '';
      if (name.length < 2 || name.length > 80) {
        return NextResponse.json({ error: 'City name required' }, { status: 400 });
      }
      const loc = await findOrCreateCity({
        name,
        countryName: typeof body.newCity.country === 'string' ? body.newCity.country : null,
      });
      locationId = loc.id;
    }
    if (!locationId || !(await getLocation(locationId))) {
      return NextResponse.json({ error: 'Location not found' }, { status: 404 });
    }

    if (action === 'set_home') {
      const loc = await getLocation(locationId);
      await query(
        `update members set home_location_id = $2, home_city = $3, home_country = $4 where id = $1`,
        [member.id, locationId, loc!.name, loc!.country_name]
      );
    } else if (action === 'follow') {
      await query(
        `insert into member_locations (member_id, location_id) values ($1, $2) on conflict do nothing`,
        [member.id, locationId]
      );
      await track('city_followed', { memberId: member.id, metadata: { location_id: locationId } });
    } else if (action === 'unfollow') {
      await query(
        `delete from member_locations where member_id = $1 and location_id = $2`,
        [member.id, locationId]
      );
    } else {
      return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
    }
    return NextResponse.json({ ok: true, places: await memberPlaces(member.id) });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error(err);
    return NextResponse.json({ error: 'Something went wrong' }, { status: 500 });
  }
}
