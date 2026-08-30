import { NextRequest, NextResponse } from 'next/server';
import { clearSession } from '@/lib/auth';

export async function POST(req: NextRequest) {
  await clearSession();
  return NextResponse.redirect(new URL('/', req.url), 303);
}
