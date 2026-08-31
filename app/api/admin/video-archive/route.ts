import { NextRequest, NextResponse } from 'next/server';
import { getCurrentMember } from '@/lib/auth';
import { query } from '@/lib/db';
import { autoMatchArtists, importYouTubeChannel } from '@/lib/videoArchive';
import { extractVideoMoments, reviewMoment } from '@/lib/videoMomentsAI';

async function admin() { const m=await getCurrentMember(); return m?.role==='admin' ? m : null; }

export async function GET() {
  if (!await admin()) return NextResponse.json({error:'Forbidden'},{status:403});
  const videos=await query(`select v.*, coalesce(json_agg(distinct jsonb_build_object('id',a.id,'name',a.name,'slug',a.slug)) filter(where a.id is not null),'[]') artists,
    (select count(*)::int from artist_video_moments m where m.video_id=v.id) moment_count,
    (select count(*)::int from artist_video_moments m where m.video_id=v.id and m.status='review') review_count
    from artist_videos v left join artist_video_artists va on va.video_id=v.id left join artists a on a.id=va.artist_id
    group by v.id order by v.published_at desc nulls last limit 500`);
  const moments=await query(`select m.*,v.title video_title,v.youtube_video_id from artist_video_moments m join artist_videos v on v.id=m.video_id
    where m.status='review' order by m.created_at desc limit 200`);
  const sync=await query(`select * from youtube_channel_imports order by updated_at desc`);
  return NextResponse.json({videos,moments,sync});
}

export async function POST(req: NextRequest) {
  const me=await admin(); if(!me) return NextResponse.json({error:'Forbidden'},{status:403});
  const body=await req.json();
  if(body.action==='sync') {
    try { return NextResponse.json(await importYouTubeChannel(body.channelKey || 'oshioma')); }
    catch(e){ return NextResponse.json({error:e instanceof Error?e.message:'Sync failed'},{status:400}); }
  }
  if(body.action==='match' && body.videoId) return NextResponse.json({matches:await autoMatchArtists(body.videoId)});
  if(body.action==='extract' && body.videoId) {
    try { return NextResponse.json(await extractVideoMoments(body.videoId)); }
    catch(e){ return NextResponse.json({error:e instanceof Error?e.message:'Extraction failed'},{status:400}); }
  }
  if(body.action==='review' && body.momentId && (body.decision==='publish'||body.decision==='reject')) {
    return NextResponse.json(await reviewMoment(body.momentId,body.decision));
  }
  if(body.action==='bulk-review' && (body.decision==='publish'||body.decision==='reject')) {
    const status=body.decision==='publish'?'published':'hidden';
    const rows=await query<{id:string}>(`update artist_video_moments set status=$1::artist_video_status,updated_at=now() where status='review' returning id`,[status]);
    return NextResponse.json({ok:true,updated:rows.length,decision:body.decision});
  }
  if(body.action==='hide-moment' && body.momentId) {
    const rows=await query<{id:string}>(`update artist_video_moments set status='hidden',updated_at=now() where id=$1 returning id`,[body.momentId]);
    if(!rows.length) return NextResponse.json({error:'Moment not found'},{status:404});
    return NextResponse.json({ok:true,hidden:1});
  }
  if(body.action==='update' && body.videoId) {
    await query(`update artist_videos set is_interview=coalesce($2,is_interview), status=coalesce($3::artist_video_status,status),
      transcript_text=coalesce($4,transcript_text), transcript_status=case when $4::text is not null then 'ready'::video_transcript_status else transcript_status end,
      transcript_source=case when $4::text is not null then 'manual' else transcript_source end, updated_at=now() where id=$1`,
      [body.videoId, body.isInterview ?? null, body.status ?? null, body.transcript ?? null]);
    return NextResponse.json({ok:true});
  }
  if(body.action==='moment' && body.videoId && body.title && Number.isFinite(body.startSeconds)) {
    const rows=await query(`insert into artist_video_moments(video_id,start_seconds,end_seconds,title,summary,topic_slug,topic_label,status,source)
      values($1,$2,$3,$4,$5,$6,$7,$8::artist_video_status,'admin') returning *`,
      [body.videoId,body.startSeconds,body.endSeconds??null,body.title,body.summary??null,body.topicSlug??null,body.topicLabel??null,body.status||'published']);
    return NextResponse.json({moment:rows[0]});
  }
  return NextResponse.json({error:'Unknown action'},{status:400});
}
