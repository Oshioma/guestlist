// SCAN NOW: admin-triggered scan of one source.

import { NextRequest, NextResponse } from 'next/server';
import { AuthError, requireAdmin } from '@/lib/auth';
import { scanSource } from '@/lib/supply/scanner';

export const maxDuration = 300;

export async function POST(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    await requireAdmin();
    const { id } = await ctx.params;
    const result = await scanSource(id);
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error(err);
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Scan failed' }, { status: 500 });
  }
}
