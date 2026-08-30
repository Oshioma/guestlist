import { NextRequest, NextResponse } from 'next/server';
import { AuthError, requireAdmin } from '@/lib/auth';
import { createEvent, validateEventInput, type EventInput } from '@/lib/adminEvents';

export async function POST(req: NextRequest) {
  try {
    const admin = await requireAdmin();
    const input = (await req.json().catch(() => ({}))) as EventInput;
    const problem = validateEventInput(input);
    if (problem) return NextResponse.json({ error: problem }, { status: 400 });

    const result = await createEvent(input, admin.id);
    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error(err);
    return NextResponse.json({ error: 'Something went wrong' }, { status: 500 });
  }
}
