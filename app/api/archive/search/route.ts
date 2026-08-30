// Archive search: grouped results (scene entities, historical events,
// flyers) — never one unstructured dump.

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentMember } from '@/lib/auth';
import { searchArchive } from '@/lib/archive/core';
import { track } from '@/lib/analytics';

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get('q') ?? '';
  const member = await getCurrentMember();
  const results = await searchArchive(q, member?.id ?? null);
  if (q.trim()) {
    await track('archive_search', { memberId: member?.id ?? null, metadata: { q: q.slice(0, 80) } });
  }
  return NextResponse.json(results);
}
