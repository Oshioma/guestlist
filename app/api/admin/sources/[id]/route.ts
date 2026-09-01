import { NextRequest, NextResponse } from 'next/server';
import { AuthError, requireAdmin } from '@/lib/auth';
import { query, queryOne } from '@/lib/db';
import { audit } from '@/lib/audit';
import { cleanGenreIds, cleanPlace, cleanCountry } from '@/lib/util';

const TRUST_VALUES = ['new', 'trusted', 'restricted', 'blocked'];

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin();
    const { id } = await ctx.params;
    // Scan history and genre tags cascade; events found through this source
    // stay (their source_id nulls out) — deleting a source never deletes
    // the events it discovered.
    const row = await queryOne<{ name: string; url: string }>(
      `delete from event_sources where id = $1 returning name, url`, [id]);
    if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    await audit('source_deleted', { actorId: admin.id, detail: { sourceId: id, name: row.name, url: row.url } });
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error(err);
    return NextResponse.json({ error: 'Something went wrong' }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin();
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

    if (body.name !== undefined) {
      const name = String(body.name).trim();
      if (!name) return NextResponse.json({ error: 'Name is required' }, { status: 400 });
      set('name', name.slice(0, 200));
    }
    if (body.url !== undefined) {
      let parsed: URL;
      try {
        parsed = new URL(String(body.url).trim());
        if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error();
      } catch {
        return NextResponse.json({ error: 'A valid URL is required' }, { status: 400 });
      }
      const clash = await queryOne(
        `select 1 from event_sources where url = $1 and id <> $2`, [parsed.toString(), id]);
      if (clash) return NextResponse.json({ error: 'Another source already uses that URL' }, { status: 409 });
      set('url', parsed.toString());
    }
    if (body.city !== undefined) set('city', cleanPlace(body.city));
    if (body.country !== undefined) set('country', cleanCountry(body.country));

    // Genres are replaced as a set (not appended) so the tag editor's state
    // is the whole truth.
    const replaceGenres = body.genreIds !== undefined;
    const genreIds = replaceGenres ? cleanGenreIds(body.genreIds) : [];

    if (!sets.length && !replaceGenres) {
      return NextResponse.json({ error: 'Nothing to update' }, { status: 400 });
    }

    const before = body.trust !== undefined
      ? await queryOne<{ trust: string; promoter_id: string | null }>(
          `select trust, promoter_id from event_sources where id = $1`, [id]
        )
      : null;

    args.push(id);
    const rows = await query(
      `update event_sources set ${sets.length ? `${sets.join(', ')}, ` : ''}updated_at = now()
        where id = $${args.length} returning id`,
      args
    );
    if (rows.length === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    if (replaceGenres) {
      await query(`delete from event_source_genres where source_id = $1`, [id]);
      if (genreIds.length) {
        await query(
          `insert into event_source_genres (source_id, genre_id)
           select $1, g.id from genres g where g.id = any($2::uuid[])
           on conflict do nothing`,
          [id, genreIds]
        );
      }
    }

    if (before && before.trust !== body.trust) {
      await audit('source_trust_changed', {
        actorId: admin.id, sourceId: id, promoterId: before.promoter_id,
        detail: { from: before.trust, to: body.trust },
      });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error(err);
    return NextResponse.json({ error: 'Something went wrong' }, { status: 500 });
  }
}
