import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, AuthError } from '@/lib/auth';
import { adminReviewArticle } from '@/lib/articles';

const ACTIONS=new Set(['request_changes','approve','publish','reject','archive','feature']);
export async function PATCH(req:NextRequest,{params}:{params:Promise<{id:string}>}){
  try{const me=await requireAdmin();const {id}=await params;const body=await req.json().catch(()=>({}));if(!ACTIONS.has(body.action))return NextResponse.json({error:'Invalid action'},{status:400});const article=await adminReviewArticle(id,me.id,body.action,typeof body.note==='string'?body.note:undefined,body.featured===true);return article?NextResponse.json({article}):NextResponse.json({error:'Not found'},{status:404});}
  catch(e){if(e instanceof AuthError)return NextResponse.json({error:e.message},{status:e.status});console.error(e);return NextResponse.json({error:'Moderation failed'},{status:500});}
}
