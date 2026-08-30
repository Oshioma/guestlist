import { NextRequest, NextResponse } from 'next/server';
import { AuthError, requireAdmin } from '@/lib/auth';
import { query } from '@/lib/db';

const TRUST_VALUES = ['new', 'trusted', 'restricted', 'blocked'];

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    await requireAdmin();
    const { id } = await ctx.params;
    const body = await req.json().catch(() => ({}));

    const sets: string[] = [];
    const args: unknown[] = [];
    const set = (col: string, val: unknown) => {
      args.push(val);
      sets.push(`${col} = $${args.length}`);
    };

    if (typeof body.active === 'boolean') set('active', body.active);
    if (typeof body.pollingEnabled === 'boolean') set('polling_enabled', body.pollingEnabled);
    if (body.pollFrequencyHours !== undefined) {
      const n = Number(body.pollFrequencyHours);
      if (!Number.isInteger(n) || n < 1 || n > 24 * 30) {
        return NextResponse.json({ error: 'Poll frequency must be 1–720 hours' }, { status: 400 });
      }
      set('poll_frequency_hours', n);
    }
    if (body.trust !== undefined) {
      if (!TRUST_VALUES.includes(body.trust)) {
        return NextResponse.json({ error: 'Invalid trust level' }, { status: 400 });
      }
      set('trust', body.trust);
    }
    if (body.feedUrl !== undefined) {
      if (body.feedUrl === null || body.feedUrl === '') {
        set('feed_url', null);
      } else {
        try {
          const u = new URL(String(body.feedUrl));
          if (!['http:', 'https:'].includes(u.protocol)) throw new Error();
          set('feed_url', u.toString());
        } catch {
          return NextResponse.json({ error: 'Invalid feed URL' }, { status: 400 });
        }
      }
    }

    if (!sets.length) return NextResponse.json({ error: 'Nothing to update' }, { status: 400 });

    args.push(id);
    const rows = await query(
      `update event_sources set ${sets.join(', ')}, updated_at = now() where id = $${args.length} returning id`,
      args
    );
    if (rows.length === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error(err);
    return NextResponse.json({ error: 'Something went wrong' }, { status: 500 });
  }
}
