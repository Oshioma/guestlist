// Search historical scene entities ("Where did you go?" → [ Space ] →
// SPACE · Ibiza · Spain · 1989–2016 · [ I WENT HERE ]).

import { NextRequest, NextResponse } from 'next/server';
import { AuthError, requireMember } from '@/lib/auth';
import { searchSceneEntities } from '@/lib/scene';

export async function GET(req: NextRequest) {
  try {
    const member = await requireMember();
    const q = req.nextUrl.searchParams.get('q') ?? '';
    return NextResponse.json({ results: await searchSceneEntities(q, member.id) });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error(err);
    return NextResponse.json({ error: 'Something went wrong' }, { status: 500 });
  }
}
