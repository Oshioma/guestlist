import { NextRequest, NextResponse } from 'next/server';
import { getCurrentMember } from '@/lib/auth';
import { query } from '@/lib/db';
import { autoMatchArtists, importYouTubeChannel } from '@/lib/videoArchive';
import { extractVideoMoments, reviewMoment } from '@/lib/videoMomentsAI';
import { pullYouTubeTranscript, youtubeConnectionStatus } from '@/lib/youtubeOAuth';

async function admin() { const m=await getCurrentMember(); return m?.role==='admin' ? m : null; }

export async function GET() {
  if (!await admin()) return NextResponse.json({error:'Forbidden'},{status:403});
  const videos=await query(`select v.*, coalesce(json_agg(distinct jsonb_build_object('id',a.id,'name',a.name,'slug',a.slug)) filter(where a.id is not null),'[]') artists,
    (select count(*)::int from artist_video_moments m where m.video_id=v.id) moment_count,
    (select count(*)::int from artist_video_moments m where m.video_id=v.id and m.status='review') review_count,
    (select count(*)::int from artist_video_moments m where m.video_id=v.id and m.status='draft') check_count,
    (select count(*)::int from artist_video_moments m where m.video_id=v.id and m.status='published') published_count
    from artist_videos v left join artist_video_artists va on va.video_id=v.id left join artists a on a.id=va.artist_id
    group by v.id order by v.published_at desc nulls last limit 500`);

  const momentSelect=`select m.*,v.title video_title,v.youtube_video_id,
      coalesce(a.name,'Unmatched artist') artist_name,a.slug artist_slug,a.id artist_id
    from artist_video_moments m join artist_videos v on v.id=m.video_id
    left join lateral (
      select a2.id,a2.name,a2.slug from artist_video_artists va2
      join artists a2 on a2.id=va2.artist_id
      where va2.video_id=v.id
      order by case when va2.source='admin' then 0 else 1 end,
               case va2.role when 'interviewee' then 0 when 'featured' then 1 else 2 end,
               va2.confidence desc nulls last
      limit 1
    ) a on true`;
  const moments=await query(`${momentSelect} where m.status='review' order by a.name nulls last,v.published_at desc nulls last,m.start_seconds limit 300`);
  const checkMoments=await query(`${momentSelect} where m.status='draft' order by a.name nulls last,v.published_at desc nulls last,m.start_seconds limit 300`);
  const publishedMoments=await query(`${momentSelect} where m.status='published' order by a.name nulls last,v.published_at desc nulls last,m.start_seconds limit 800`);
  const sync=await query(`select * from youtube_channel_imports order by updated_at desc`);
  let youtubeConnection:{connected:boolean;channel_id?:string|null;channel_title?:string|null;connected_at?:string};
  try{youtubeConnection=await youtubeConnectionStatus()}catch{youtubeConnection={connected:false}}
  return NextResponse.json({videos,moments,checkMoments,publishedMoments,sync,youtubeConnection});
}

export async function POST(req: NextRequest) {
  const me=await admin(); if(!me) return NextResponse.json({error:'Forbidden'},{status:403});
  const body=await req.json();
  if(body.action==='sync') {
    try { return NextResponse.json(await importYouTubeChannel(body.channelKey || 'oshioma', body.reset === true)); }
    catch(e){ return NextResponse.json({error:e instanceof Error?e.message:'Sync failed'},{status:400}); }
  }
  if(body.action==='pull-transcript' && body.videoId){
    try{return NextResponse.json(await pullYouTubeTranscript(body.videoId))}
    catch(e){await query(`update artist_videos set transcript_status='failed',updated_at=now() where id=$1`,[body.videoId]);return NextResponse.json({error:e instanceof Error?e.message:'Transcript pull failed'},{status:400})}
  }
  if(body.action==='pull-interview-transcripts'){
    const limit=Math.min(Math.max(Number(body.limit)||8,1),12);
    const rows=await query<{id:string}>(`select id from artist_videos where is_interview=true and transcript_status in ('missing'::video_transcript_status,'partial'::video_transcript_status) order by published_at desc nulls last limit $1`,[limit]);
    let ready=0,failed=0;const errors:Array<{videoId:string;error:string}>=[];
    for(const row of rows){try{const result=await pullYouTubeTranscript(row.id);if(result?.found)ready++;else failed++}catch(e){failed++;const message=e instanceof Error?e.message:'Transcript pull failed';errors.push({videoId:row.id,error:message});await query(`update artist_videos set transcript_status='failed',updated_at=now() where id=$1`,[row.id])}}
    const remainingRows=await query<{count:number}>(`select count(*)::int count from artist_videos where is_interview=true and transcript_status in ('missing'::video_transcript_status,'partial'::video_transcript_status)`);
    return NextResponse.json({ok:true,processed:rows.length,ready,failed,remaining:Number(remainingRows[0]?.count||0),errors});
  }
  if(body.action==='delete-videos' && Array.isArray(body.videoIds)) {
    const ids=[...new Set(body.videoIds.filter((id:unknown)=>typeof id==='string' && id))];
    if(!ids.length) return NextResponse.json({error:'No videos selected'},{status:400});
    await query(`delete from artist_video_moment_entities where moment_id in (select id from artist_video_moments where video_id=any($1::uuid[]))`,[ids]);
    await query(`delete from artist_video_moments where video_id=any($1::uuid[])`,[ids]);
    await query(`delete from artist_video_artists where video_id=any($1::uuid[])`,[ids]);
    const rows=await query<{id:string}>(`delete from artist_videos where id=any($1::uuid[]) returning id`,[ids]);
    return NextResponse.json({ok:true,deleted:rows.length});
  }
  if(body.action==='change-artist' && Array.isArray(body.videoIds) && typeof body.artistName==='string'){
    const ids=[...new Set(body.videoIds.filter((id:unknown)=>typeof id==='string'&&id))];
    const name=body.artistName.trim();
    if(!ids.length||!name) return NextResponse.json({error:'Video and artist are required'},{status:400});
    let artists=await query<{id:string;name:string;slug:string}>(`select id,name,slug from artists where lower(name)=lower($1) order by name limit 2`,[name]);
    if(!artists.length){
      artists=await query<{id:string;name:string;slug:string}>(`select id,name,slug from artists where name ilike '%'||$1||'%' order by case when name ilike $1||'%' then 0 else 1 end,length(name),name limit 6`,[name]);
      if(artists.length!==1) return NextResponse.json({error:artists.length?`More than one artist matches. Enter the exact name: ${artists.map(a=>a.name).join(', ')}`:`No artist found matching “${name}”.`},{status:400});
    }
    const artist=artists[0];
    for(const videoId of ids){
      await query(`delete from artist_video_artists where video_id=$1 and role='interviewee'`,[videoId]);
      await query(`insert into artist_video_artists(video_id,artist_id,role,confidence,source) values($1,$2,'interviewee',100,'admin') on conflict(video_id,artist_id,role) do update set confidence=100,source='admin'`,[videoId,artist.id]);
    }
    return NextResponse.json({ok:true,updated:ids.length,artist});
  }
  if(body.action==='match' && body.videoId) return NextResponse.json({matches:await autoMatchArtists(body.videoId)});
  if(body.action==='extract' && body.videoId) {try{return NextResponse.json(await extractVideoMoments(body.videoId))}catch(e){return NextResponse.json({error:e instanceof Error?e.message:'Extraction failed'},{status:400})}}
  if(body.action==='stage-moment' && body.momentId){await query(`update artist_video_moments set status='draft',updated_at=now() where id=$1 and status='review'`,[body.momentId]);return NextResponse.json({ok:true})}
  if(body.action==='bulk-stage'){const rows=await query<{id:string}>(`update artist_video_moments set status='draft',updated_at=now() where status='review' returning id`);return NextResponse.json({ok:true,updated:rows.length})}
  if(body.action==='review' && body.momentId && (body.decision==='publish'||body.decision==='reject')) return NextResponse.json(await reviewMoment(body.momentId,body.decision));
  if(body.action==='bulk-review' && (body.decision==='publish'||body.decision==='reject')) {
    const status=body.decision==='publish'?'published':'hidden';
    const rows=await query<{id:string}>(`update artist_video_moments set status=$1::artist_video_status,updated_at=now() where status='draft' returning id`,[status]);
    return NextResponse.json({ok:true,updated:rows.length,decision:body.decision});
  }
  if(body.action==='hide-moment' && body.momentId) {const rows=await query<{id:string}>(`update artist_video_moments set status='hidden',updated_at=now() where id=$1 returning id`,[body.momentId]);if(!rows.length)return NextResponse.json({error:'Moment not found'},{status:404});return NextResponse.json({ok:true,hidden:1})}
  if(body.action==='update' && body.videoId) {
    await query(`update artist_videos set is_interview=coalesce($2,is_interview), status=coalesce($3::artist_video_status,status), transcript_text=coalesce($4,transcript_text), transcript_status=case when $4::text is not null then 'ready'::video_transcript_status else transcript_status end, transcript_source=case when $4::text is not null then 'manual' else transcript_source end, updated_at=now() where id=$1`,[body.videoId,body.isInterview??null,body.status??null,body.transcript??null]);
    if(body.isInterview===true&&body.transcript==null){try{const transcriptResult=await pullYouTubeTranscript(body.videoId);return NextResponse.json({ok:true,autoTranscript:transcriptResult})}catch(e){await query(`update artist_videos set transcript_status='failed',updated_at=now() where id=$1`,[body.videoId]);return NextResponse.json({ok:true,autoTranscript:{found:false,error:e instanceof Error?e.message:'Transcript pull failed'}})}}
    return NextResponse.json({ok:true});
  }
  if(body.action==='moment' && body.videoId && body.title && Number.isFinite(body.startSeconds)) {const rows=await query(`insert into artist_video_moments(video_id,start_seconds,end_seconds,title,summary,topic_slug,topic_label,status,source) values($1,$2,$3,$4,$5,$6,$7,$8::artist_video_status,'admin') returning *`,[body.videoId,body.startSeconds,body.endSeconds??null,body.title,body.summary??null,body.topicSlug??null,body.topicLabel??null,body.status||'published']);return NextResponse.json({moment:rows[0]})}
  return NextResponse.json({error:'Unknown action'},{status:400});
}
