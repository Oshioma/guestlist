import { NextRequest, NextResponse } from 'next/server';
import { requireMember, AuthError } from '@/lib/auth';
import { getAuthorArticle, submitArticle, updateDraft } from '@/lib/articles';

export async function GET(_req:NextRequest,{params}:{params:Promise<{id:string}>}){
  try { const me=await requireMember(); const {id}=await params; const article=await getAuthorArticle(id,me.id); return article?NextResponse.json({article}):NextResponse.json({error:'Not found'},{status:404}); }
  catch(e){if(e instanceof AuthError)return NextResponse.json({error:e.message},{status:e.status});throw e;}
}
export async function PATCH(req:NextRequest,{params}:{params:Promise<{id:string}>}){
  try { const me=await requireMember(); const {id}=await params; const body=await req.json().catch(()=>({}));
    if(body.action==='submit') return NextResponse.json({article:await submitArticle(id,me.id)});
    const article=await updateDraft(id,me.id,body); return article?NextResponse.json({article}):NextResponse.json({error:'Not found'},{status:404});
  } catch(e){ if(e instanceof AuthError)return NextResponse.json({error:e.message},{status:e.status}); const message=e instanceof Error?e.message:'Could not save article'; return NextResponse.json({error:message},{status:400}); }
}
