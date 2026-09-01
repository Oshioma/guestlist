import { NextResponse } from 'next/server';
import { AuthError, requireAdmin } from '@/lib/auth';

export async function GET() {
  try {
    const admin = await requireAdmin();
    return NextResponse.json({ admin: true, id: admin.id });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ admin: false }, { status: err.status });
    }
    console.error(err);
    return NextResponse.json({ admin: false }, { status: 500 });
  }
}
