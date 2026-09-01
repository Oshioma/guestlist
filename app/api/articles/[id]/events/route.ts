// Which events an article is about.
//
// GET is the picker's search (?q=), PUT replaces the whole set. Only the
// article's own author or an admin may change the links: an article claiming
// to be about tonight is a claim about someone else's night, so it is not
// something any member should be able to attach.

import { NextRequest, NextResponse } from 'next/server';
import { AuthError, requireMember } from '@/lib/auth';
import { queryOne } from '@/lib/db';
import { eventsForArticle, searchLinkableEvents, setArticleEvents } from '@/lib/articles';

async function mayEdit(articleId: string, memberId: string, role: string): Promise<boolean> {
  if (role === 'admin') return true;
  const own = await queryOne<{ id: string }>(
    `select id from articles where id = $1 and author_id = $2`, [articleId, memberId]
  );
  return !!own;
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const me = await requireMember();
    const { id } = await params;
    if (!(await mayEdit(id, me.id, me.role))) {
      return NextResponse.json({ error: 'Not yours to edit' }, { status: 403 });
    }
    const q = req.nextUrl.searchParams.get('q')?.trim() ?? '';
    return NextResponse.json({
      linked: await eventsForArticle(id),
      results: q.length >= 2 ? await searchLinkableEvents(q) : [],
    });
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const me = await requireMember();
    const { id } = await params;
    if (!(await mayEdit(id, me.id, me.role))) {
      return NextResponse.json({ error: 'Not yours to edit' }, { status: 403 });
    }
    const body = await req.json().catch(() => ({}));
    const eventIds: string[] = Array.isArray(body.eventIds) ? body.eventIds.map(String) : [];
    await setArticleEvents(id, eventIds, me.id);
    return NextResponse.json({ linked: await eventsForArticle(id) });
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
}
