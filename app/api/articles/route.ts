import { NextResponse } from 'next/server';
import { requireMember, AuthError } from '@/lib/auth';
import { createDraft, listAuthorArticles } from '@/lib/articles';

export async function GET(){
  try { const me=await requireMember(); return NextResponse.json({articles:await listAuthorArticles(me.id)}); }
  catch(e){if(e instanceof AuthError)return NextResponse.json({error:e.message},{status:e.status});throw e;}
}
export async function POST(){
  try { const me=await requireMember(); const draft=await createDraft(me.id); return NextResponse.json(draft,{status:201}); }
  catch(e){if(e instanceof AuthError)return NextResponse.json({error:e.message},{status:e.status});console.error(e);return NextResponse.json({error:'Could not create article'},{status:500});}
}
