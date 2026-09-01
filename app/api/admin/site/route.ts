// Site-wide switches an admin can flip without a deploy. Currently: which
// optional sections show in the main navigation.

import { NextRequest, NextResponse } from 'next/server';
import { AuthError, requireAdmin } from '@/lib/auth';
import { getNavVisibility, setNavVisibility } from '@/lib/settings';

export async function GET() {
  try {
    await requireAdmin();
    return NextResponse.json({ nav: await getNavVisibility() });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    return NextResponse.json({ error: 'Something went wrong' }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const admin = await requireAdmin();
    const body = await req.json().catch(() => ({}));
    const patch = body.nav ?? {};
    const nav = await setNavVisibility(
      {
        explore: typeof patch.explore === 'boolean' ? patch.explore : undefined,
        people: typeof patch.people === 'boolean' ? patch.people : undefined,
      },
      admin.id
    );
    return NextResponse.json({ ok: true, nav });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error(err);
    return NextResponse.json({ error: 'Something went wrong' }, { status: 500 });
  }
}
