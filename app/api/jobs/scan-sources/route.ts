// Scheduled polling entrypoint: scans every source whose polling schedule is
// due. Server-side only — call it from cron, e.g.:
//
//   */30 * * * *  curl -s -X POST https://guestlist.net/api/jobs/scan-sources \
//                   -H "Authorization: Bearer $SUPPLY_CRON_SECRET"
//
// (Or a Vercel Cron entry hitting this path.) Auth: the SUPPLY_CRON_SECRET
// bearer token, or an admin session for manual runs.

import { NextRequest, NextResponse } from 'next/server';
import { timingSafeEqual } from 'node:crypto';
import { getCurrentMember } from '@/lib/auth';
import { scanDueSources } from '@/lib/supply/scanner';

export const maxDuration = 300;

function secretMatches(header: string | null): boolean {
  const secret = process.env.SUPPLY_CRON_SECRET;
  if (!secret || !header?.startsWith('Bearer ')) return false;
  const provided = Buffer.from(header.slice(7));
  const expected = Buffer.from(secret);
  return provided.length === expected.length && timingSafeEqual(provided, expected);
}

export async function POST(req: NextRequest) {
  if (!secretMatches(req.headers.get('authorization'))) {
    const member = await getCurrentMember();
    if (member?.role !== 'admin') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  }
  const { scanned, results } = await scanDueSources();
  return NextResponse.json({
    ok: true,
    scanned,
    results: results.map((r) => ({
      scanId: r.scanId, status: r.status, method: r.method,
      candidates: r.candidatesFound, new: r.newCandidates,
      extracted: r.extracted, failed: r.failed, duplicates: r.duplicates,
    })),
  });
}
