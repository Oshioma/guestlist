// Personalised recommendations for the signed-in member. Same service the
// pages and email use — this endpoint exists for client refreshes and for
// the deterministic test suite. Reasons are human strings; scores stay
// internal.

import { NextRequest, NextResponse } from 'next/server';
import { AuthError, requireMember } from '@/lib/auth';
import {
  getRecommendedEvents, reasonText, trackRecommendationImpressions, weekendWindow,
} from '@/lib/recommend';

export async function GET(req: NextRequest) {
  try {
    const member = await requireMember();
    const p = req.nextUrl.searchParams;
    const context = p.get('context') ?? 'foryou';
    const limit = Math.min(Number(p.get('limit')) || 12, 40);
    const locationId = p.get('locationId');

    let from: Date | null = null;
    let to: Date | null = null;
    if (context === 'weekend') {
      ({ from, to } = weekendWindow());
    }
    const recs = await getRecommendedEvents(member.id, {
      limit,
      locationId: locationId || null,
      from, to,
      exploration: p.get('exploration') !== 'false',
    });
    if (p.get('track') !== 'false') {
      await trackRecommendationImpressions(member.id, recs, context);
    }
    return NextResponse.json({
      recommendations: recs.map((r) => ({
        ...r,
        score: undefined, // never expose raw scores
        reason_codes: r.reasons.map((x) => x.code),
        reason_texts: r.reasons.slice(0, 2).map(reasonText),
      })),
    });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error(err);
    return NextResponse.json({ error: 'Something went wrong' }, { status: 500 });
  }
}
