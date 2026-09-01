import { createHash } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { getCurrentMember } from '@/lib/auth';
import { queryOne } from '@/lib/db';
import { processUrlSubmission } from '@/lib/ingestion';
import { track } from '@/lib/analytics';
import { supplyConfig } from '@/lib/supply/config';
import { fmtDate } from '@/lib/util';

// Abuse protection: Guestlist must not become a URL-fetch proxy, an AI-cost
// attack vector or a spam ingestion endpoint. Limits are configurable via
// SUPPLY_SUBMISSIONS_PER_MEMBER_HOUR / SUPPLY_SUBMISSIONS_PER_IP_HOUR.

function hashIp(req: NextRequest): string {
  const ip =
    req.headers.get('x-forwarded-for')?.split(',')[0].trim() ||
    req.headers.get('x-real-ip') ||
    'unknown';
  return createHash('sha256')
    .update(`${ip}:${process.env.SESSION_SECRET ?? ''}`)
    .digest('hex');
}

function safeSubmissionUrl(raw: string): string | null {
  try {
    const parsed = new URL(raw.trim());
    if (!['http:', 'https:'].includes(parsed.protocol)) return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

export const maxDuration = 120;

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const url = String(body.url ?? '').trim();
  if (!url) return NextResponse.json({ error: 'A link is required' }, { status: 400 });

  const member = await getCurrentMember();
  const ipHash = hashIp(req);

  const limit = member
    ? supplyConfig.rateLimit.memberPerHour
    : supplyConfig.rateLimit.anonPerIpPerHour;
  const recent = await queryOne<{ n: number }>(
    member
      ? `select count(*)::int as n from event_submissions
          where submitted_by = $1 and created_at > now() - interval '1 hour'`
      : `select count(*)::int as n from event_submissions
          where ip_hash = $1 and created_at > now() - interval '1 hour'`,
    [member ? member.id : ipHash]
  );
  if ((recent?.n ?? 0) >= limit) {
    return NextResponse.json(
      { error: 'That’s a lot of links at once — give us an hour to catch up.' },
      { status: 429 }
    );
  }

  // Manual fallback stays inside the existing event_submissions queue. It
  // does not create a parallel importer or bypass editorial review.
  if (body.manual === true) {
    const cleanUrl = safeSubmissionUrl(url);
    if (!cleanUrl) {
      return NextResponse.json({ error: 'That doesn’t look like a valid link.' }, { status: 400 });
    }
    const title = String(body.title ?? '').trim();
    if (!title) return NextResponse.json({ error: 'Event name is required' }, { status: 400 });

    const note = [
      'Manual submission',
      `Title: ${title}`,
      body.date ? `Date: ${String(body.date).trim()}` : null,
      body.venue ? `Venue: ${String(body.venue).trim()}` : null,
      body.city ? `City: ${String(body.city).trim()}` : null,
      body.notes ? `Notes: ${String(body.notes).trim()}` : null,
      body.importError ? `Automatic import error: ${String(body.importError).trim()}` : null,
    ]
      .filter(Boolean)
      .join('\n')
      .slice(0, 5000);

    const submission = await queryOne<{ id: string }>(
      `insert into event_submissions (url, submitted_by, ip_hash, note)
       values ($1, $2, $3, $4)
       returning id`,
      [cleanUrl, member?.id ?? null, ipHash, note]
    );

    await track('event_submitted', {
      memberId: member?.id ?? null,
      metadata: { url: cleanUrl, outcome: 'manual', submissionId: submission?.id ?? null },
    });

    return NextResponse.json({
      ok: true,
      outcome: 'manual',
      message: 'Thanks — we have the details and will review them.',
    });
  }

  const result = await processUrlSubmission(url, member?.id ?? null, { ipHash });

  if (result.status === 'invalid') {
    return NextResponse.json({ error: result.message }, { status: 400 });
  }

  await track('event_submitted', {
    memberId: member?.id ?? null,
    eventId: result.eventId,
    metadata: { url, outcome: result.status },
  });

  // Public response: friendly, no confidence scores, no AI debugging.
  if (result.status === 'duplicate') {
    return NextResponse.json({
      ok: true,
      outcome: 'duplicate',
      message: 'Good news — we already have that one on our radar.',
    });
  }
  if (result.status === 'created' && result.summary) {
    const parts = [
      result.summary.title,
      result.summary.date
        ? fmtDate(result.summary.date, 'Europe/London', { weekday: 'long', day: 'numeric', month: 'long' })
        : null,
      result.summary.city,
    ].filter(Boolean);
    return NextResponse.json({
      ok: true,
      outcome: 'created',
      found: parts,
      eventId: member?.role === 'admin' ? result.eventId : undefined,
      message: 'Thanks for helping build Guestlist.',
    });
  }
  return NextResponse.json({
    ok: true,
    outcome: 'checking',
    message: 'Thanks — we’re checking it.',
  });
}
