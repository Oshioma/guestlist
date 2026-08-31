import { query, queryOne } from './db';

type ProposedMoment = {
  startSeconds: number;
  endSeconds?: number | null;
  title: string;
  summary?: string | null;
  excerpt?: string | null;
  topicSlug?: string | null;
  topicLabel?: string | null;
};

type ClaudeResponse = { content?: Array<{ type: string; text?: string }> };

function cleanJson(text: string) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  return (fenced?.[1] || text).trim();
}

function validMoment(x: unknown): x is ProposedMoment {
  if (!x || typeof x !== 'object') return false;
  const m = x as Record<string, unknown>;
  return Number.isFinite(m.startSeconds) && Number(m.startSeconds) >= 0 && typeof m.title === 'string' && m.title.trim().length > 2;
}

export async function extractVideoMoments(videoId: string) {
  const video = await queryOne<{id:string; title:string; transcript_text:string|null; duration_seconds:number|null}>(
    `select id,title,transcript_text,duration_seconds from artist_videos where id=$1`, [videoId]
  );
  if (!video) throw new Error('Video not found');
  if (!video.transcript_text?.trim()) throw new Error('Add a transcript first');
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error('ANTHROPIC_API_KEY is not configured');

  const prompt = `You are indexing an original Guestlist DJ/artist interview.\n\nVIDEO: ${video.title}\nDURATION_SECONDS: ${video.duration_seconds ?? 'unknown'}\n\nTRANSCRIPT:\n${video.transcript_text.slice(0, 120000)}\n\nReturn ONLY valid JSON: {"moments":[...]}. Identify 4-12 genuinely useful self-contained moments. Each moment must use only facts actually present in the transcript. Fields: startSeconds integer, endSeconds integer|null, title concise, summary 1 sentence, excerpt short verbatim excerpt if useful, topicSlug lowercase-hyphenated, topicLabel human label. If timestamps are absent from the transcript, use startSeconds 0 and do not pretend to know an exact timestamp. Never invent artists, clubs, dates, genres or stories.`;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {'content-type':'application/json','x-api-key':key,'anthropic-version':'2023-06-01'},
    body: JSON.stringify({model:process.env.INTERVIEW_AI_MODEL || 'claude-sonnet-4-20250514',max_tokens:3500,messages:[{role:'user',content:prompt}]})
  });
  if (!res.ok) throw new Error(`Claude ${res.status}: ${(await res.text()).slice(0,300)}`);
  const data = await res.json() as ClaudeResponse;
  const text = data.content?.find(c=>c.type==='text')?.text || '';
  let parsed: {moments?: unknown[]};
  try { parsed = JSON.parse(cleanJson(text)); } catch { throw new Error('AI returned invalid JSON'); }
  const moments = (parsed.moments || []).filter(validMoment).slice(0,12);
  if (!moments.length) throw new Error('No usable moments found');

  await query(`delete from artist_video_moments where video_id=$1 and source='ai' and status='review'`, [videoId]);
  for (const m of moments) {
    const start = Math.max(0, Math.floor(m.startSeconds));
    const end = Number.isFinite(m.endSeconds) && Number(m.endSeconds) > start ? Math.floor(Number(m.endSeconds)) : null;
    await query(`insert into artist_video_moments(video_id,start_seconds,end_seconds,title,summary,transcript_excerpt,topic_slug,topic_label,status,confidence,source)
      values($1,$2,$3,$4,$5,$6,$7,$8,'review',85,'ai') on conflict do nothing`,
      [videoId,start,end,m.title.trim(),m.summary?.trim()||null,m.excerpt?.trim()||null,m.topicSlug?.trim()||null,m.topicLabel?.trim()||null]);
  }
  return {created:moments.length};
}

export async function reviewMoment(momentId: string, decision: 'publish'|'reject') {
  if (decision === 'publish') {
    await query(`update artist_video_moments set status='published',updated_at=now() where id=$1`, [momentId]);
  } else {
    await query(`update artist_video_moments set status='hidden',updated_at=now() where id=$1`, [momentId]);
  }
  return {ok:true};
}
