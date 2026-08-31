import { randomUUID } from 'node:crypto';
import { query } from '../db';
import { searchVideoMoments, youtubeTimestampUrl } from '../videoArchive';
import type { AskAnswer, AskCard } from './types';

// Narrow opt-in route: ordinary event questions stay in the established Ask engine.
export function looksLikeInterviewQuestion(q:string) {
  return /\b(said|say|talk(?:ed)? about|interview|in their words|what did|story about|remember(?:s|ed)?|thoughts on)\b/i.test(q);
}

export async function answerFromInterviews(question:string, conversationId?:string|null):Promise<AskAnswer|null> {
  if (!looksLikeInterviewQuestion(question)) return null;
  const words=question.toLowerCase().replace(/[^a-z0-9\s-]/g,' ').split(/\s+/).filter(w=>w.length>2&&!['what','did','say','said','about','interview','their','words','guestlist','talked','talk'].includes(w));
  const terms=[question.trim(),...words.slice(0,6)];
  let rows: Awaited<ReturnType<typeof searchVideoMoments>>=[];
  for(const term of terms){ rows=await searchVideoMoments(term,6); if(rows.length) break; }
  if(!rows.length) return null;
  const cards:AskCard[]=rows.slice(0,3).map(r=>({
    type:'interview',id:r.id,title:r.title,slug:r.artist_slug||r.id,when:r.artist_name?`${r.artist_name} · Guestlist interview`:'Guestlist interview',
    city:null,venueName:null,price:null,imageUrl:null,genres:[],reasons:[r.topic_label||'In their words'],social:null,momentumNote:null,
    href:youtubeTimestampUrl(r.youtube_video_id,r.start_seconds)
  }));
  const conversation=conversationId||randomUUID(); const message=randomUUID();
  // Commentary is deliberately extractive/grounded: no model is allowed to invent a quote or interpretation here.
  const first=rows[0];
  const commentary=first.artist_name?`I found ${rows.length===1?'a moment':'some moments'} from ${first.artist_name} in the Guestlist interviews.`:`I found ${rows.length===1?'a moment':'some moments'} in the Guestlist interviews.`;
  try { await query(`insert into ask_messages(id,conversation_id,role,content,answer_type,created_at) values($1,$2,'assistant',$3,'INTERVIEW_DISCOVERY',now()) on conflict do nothing`,[message,conversation,commentary]); } catch { /* interview retrieval remains useful if analytics schema differs */ }
  return {type:'INTERVIEW_DISCOVERY',commentary,cards,followUps:['Show me another interview moment','What are they playing next?'],clarification:null,relaxation:null,conversationId:conversation,messageId:message};
}
