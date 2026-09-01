import { NextRequest, NextResponse } from 'next/server';
import { requireMember, AuthError } from '@/lib/auth';

type AiResult={headlines?:string[];excerpt?:string;tags?:string[];imageQueries?:string[];notes?:string[]};
function cleanJson(s:string){const m=s.match(/```(?:json)?\s*([\s\S]*?)```/i);return (m?.[1]||s).trim();}
function fallback(title:string,body:string):AiResult{
  const words=(title+' '+body).toLowerCase().match(/[a-z]{5,}/g)||[]; const freq=new Map<string,number>();
  for(const w of words)freq.set(w,(freq.get(w)||0)+1); const tags=[...freq.entries()].sort((a,b)=>b[1]-a[1]).map(x=>x[0]).filter(w=>!['about','which','their','there','would','could','because'].includes(w)).slice(0,5);
  return {headlines:title?[title]:[],excerpt:body.replace(/\s+/g,' ').trim().slice(0,180),tags,imageQueries:[tags.slice(0,3).join(' ')||title||'nightlife culture'],notes:[]};
}
async function aiAssist(title:string,body:string):Promise<AiResult>{
  const key=process.env.ANTHROPIC_API_KEY; if(!key)return fallback(title,body);
  const model=process.env.ARTICLE_AI_MODEL?.trim()||'claude-sonnet-4-6';
  const prompt=`You are the editorial coach for Guestlist Balance. Help a community writer improve their own article without changing their voice or inventing facts. Return ONLY JSON with keys: headlines (3 concise alternatives), excerpt (max 180 chars), tags (3-6 short tags), imageQueries (3 concrete visual search phrases suitable for royalty-free editorial photography), notes (0-4 brief actionable writing notes). Do not rewrite the full article.\nTITLE: ${title.slice(0,300)}\nARTICLE:\n${body.slice(0,18000)}`;
  const r=await fetch('https://api.anthropic.com/v1/messages',{method:'POST',headers:{'content-type':'application/json','x-api-key':key,'anthropic-version':'2023-06-01'},body:JSON.stringify({model,max_tokens:1200,messages:[{role:'user',content:prompt}]})});
  if(!r.ok)return fallback(title,body); const data=await r.json() as {content?:Array<{type:string;text?:string}>}; const text=data.content?.find(c=>c.type==='text')?.text||'';
  try{return JSON.parse(cleanJson(text)) as AiResult}catch{return fallback(title,body)}
}
async function searchUnsplash(q:string){
  const key=process.env.UNSPLASH_ACCESS_KEY; if(!key||!q)return [];
  const r=await fetch(`https://api.unsplash.com/search/photos?query=${encodeURIComponent(q)}&per_page=8&orientation=landscape&client_id=${encodeURIComponent(key)}`,{next:{revalidate:3600}});
  if(!r.ok)return []; const d=await r.json() as {results?:Array<{id:string;alt_description?:string|null;urls:{regular:string;small:string};links:{html:string};user:{name:string;links:{html:string}}}>};
  return (d.results||[]).map(x=>({id:x.id,url:x.urls.regular,thumb:x.urls.small,alt:x.alt_description||q,provider:'unsplash',credit:x.user.name,sourceUrl:x.links.html,photographerUrl:x.user.links.html}));
}
export async function POST(req:NextRequest){
  try{await requireMember();const body=await req.json().catch(()=>({}));const title=typeof body.title==='string'?body.title:'';const article=typeof body.body==='string'?body.body:'';const mode=body.mode==='images'?'images':'coach';
    const suggestions=await aiAssist(title,article); const query=typeof body.query==='string'&&body.query.trim()?body.query.trim():(suggestions.imageQueries?.[0]||title);
    const images=mode==='images'?await searchUnsplash(query):[]; return NextResponse.json({suggestions,images,imageSearchConfigured:!!process.env.UNSPLASH_ACCESS_KEY,query});
  }catch(e){if(e instanceof AuthError)return NextResponse.json({error:e.message},{status:e.status});console.error(e);return NextResponse.json({error:'Assistant unavailable'},{status:500});}
}
