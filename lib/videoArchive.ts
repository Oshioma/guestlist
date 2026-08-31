import { query, queryOne } from './db';

export type VideoMoment = {
  id: string; video_id: string; start_seconds: number; end_seconds: number | null;
  title: string; summary: string | null; transcript_excerpt: string | null;
  topic_slug: string | null; topic_label: string | null;
};

export type ArtistVideo = {
  id: string; youtube_video_id: string; title: string; description: string | null;
  thumbnail_url: string | null; published_at: string | null; duration_seconds: number | null;
  source_url: string; is_interview: boolean; transcript_status: string;
  moments: VideoMoment[];
};

export type EventInterviewDiscovery = {
  artist_id: string; artist_name: string; artist_slug: string;
  video: ArtistVideo;
};

export function youtubeTimestampUrl(videoId: string, seconds: number) {
  const s = Math.max(0, Math.floor(seconds));
  return `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}&t=${s}s`;
}

export async function videosForArtist(artistId: string): Promise<ArtistVideo[]> {
  const rows = await query<Omit<ArtistVideo, 'moments'>>(
    `select v.id, v.youtube_video_id, v.title, v.description, v.thumbnail_url,
            v.published_at::text, v.duration_seconds, v.source_url, v.is_interview,
            v.transcript_status
       from artist_videos v
       join artist_video_artists va on va.video_id = v.id
      where va.artist_id = $1 and va.role in ('interviewee','featured') and v.status = 'published'
      order by v.published_at desc nulls last`, [artistId]
  );
  return Promise.all(rows.map(async (v) => ({
    ...v,
    moments: await query<VideoMoment>(
      `select id, video_id, start_seconds, end_seconds, title, summary, transcript_excerpt,
              topic_slug, topic_label
         from artist_video_moments
        where video_id = $1 and status = 'published'
        order by start_seconds`, [v.id]
    ),
  })));
}

// Quiet discovery surface for event pages. Only returns lineup artists that have
// a published Guestlist interview with at least one published AI/admin moment.
// The archive remains unlinked from global navigation and is discovered through
// the live cultural graph: event -> artist -> original interview moment.
export async function interviewsForEventArtists(artistIds: string[], limit = 4): Promise<EventInterviewDiscovery[]> {
  const ids = [...new Set(artistIds.filter(Boolean))];
  if (!ids.length) return [];
  const rows = await query<{artist_id:string;artist_name:string;artist_slug:string} & Omit<ArtistVideo,'moments'>>(
    `select distinct on (a.id)
            a.id artist_id,a.name artist_name,a.slug artist_slug,
            v.id,v.youtube_video_id,v.title,v.description,v.thumbnail_url,v.published_at::text,
            v.duration_seconds,v.source_url,v.is_interview,v.transcript_status
       from artists a
       join artist_video_artists va on va.artist_id=a.id and va.role in ('interviewee','featured')
       join artist_videos v on v.id=va.video_id
      where a.id=any($1::uuid[]) and v.status='published' and v.is_interview=true
        and exists(select 1 from artist_video_moments m where m.video_id=v.id and m.status='published')
      order by a.id,v.published_at desc nulls last
      limit $2`, [ids, Math.min(Math.max(limit,1),8)]
  );
  return Promise.all(rows.map(async row => ({
    artist_id:row.artist_id,artist_name:row.artist_name,artist_slug:row.artist_slug,
    video:{
      id:row.id,youtube_video_id:row.youtube_video_id,title:row.title,description:row.description,
      thumbnail_url:row.thumbnail_url,published_at:row.published_at,duration_seconds:row.duration_seconds,
      source_url:row.source_url,is_interview:row.is_interview,transcript_status:row.transcript_status,
      moments:await query<VideoMoment>(`select id,video_id,start_seconds,end_seconds,title,summary,transcript_excerpt,topic_slug,topic_label
        from artist_video_moments where video_id=$1 and status='published' order by start_seconds limit 3`,[row.id])
    }
  })));
}

export async function searchVideoMoments(term: string, limit = 12) {
  const q = term.trim();
  if (!q) return [];
  return query<VideoMoment & { youtube_video_id: string; video_title: string; artist_name: string | null; artist_slug: string | null }>(
    `select m.id, m.video_id, m.start_seconds, m.end_seconds, m.title, m.summary,
            m.transcript_excerpt, m.topic_slug, m.topic_label, v.youtube_video_id,
            v.title as video_title, a.name as artist_name, a.slug as artist_slug
       from artist_video_moments m
       join artist_videos v on v.id = m.video_id
       left join lateral (
         select a2.name, a2.slug from artist_video_artists va
         join artists a2 on a2.id = va.artist_id
         where va.video_id = v.id and va.role = 'interviewee' limit 1
       ) a on true
      where v.status = 'published' and m.status = 'published'
        and (m.title ilike '%' || $1 || '%' or coalesce(m.summary,'') ilike '%' || $1 || '%'
          or coalesce(m.transcript_excerpt,'') ilike '%' || $1 || '%' or coalesce(m.topic_label,'') ilike '%' || $1 || '%')
      order by case when m.title ilike '%' || $1 || '%' then 0 else 1 end, v.published_at desc nulls last
      limit $2`, [q, Math.min(Math.max(limit, 1), 50)]
  );
}

export async function autoMatchArtists(videoId: string) {
  const video = await queryOne<{ id: string; title: string; description: string | null }>(
    `select id, title, description from artist_videos where id = $1`, [videoId]
  );
  if (!video) return [];
  const haystack = `${video.title} ${video.description || ''}`;
  const matches = await query<{ id: string; name: string; slug: string }>(
    `select id, name, slug from artists
      where length(name) >= 3 and $1 ilike '%' || name || '%'
      order by length(name) desc limit 12`, [haystack]
  );
  for (const a of matches) {
    await query(
      `insert into artist_video_artists(video_id, artist_id, role, confidence, source)
       values ($1,$2,'interviewee',80,'title_match') on conflict do nothing`, [videoId, a.id]
    );
  }
  return matches;
}

export type YouTubeImportResult = {
  imported: number; updated: number; processed: number; channelId: string;
  uploadsPlaylistId: string; done: boolean; nextPageToken: string | null;
};

async function yt<T>(path: string, key: string): Promise<T> {
  const sep = path.includes('?') ? '&' : '?';
  const res = await fetch(`https://www.googleapis.com/youtube/v3/${path}${sep}key=${encodeURIComponent(key)}`, {cache:'no-store',signal:AbortSignal.timeout(15000)});
  if (!res.ok) throw new Error(`YouTube API ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return res.json() as Promise<T>;
}

function parseYouTubeDuration(value?: string): number | null {
  if (!value) return null;
  const match = value.match(/^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/);
  if (!match) return null;
  return (Number(match[1] || 0) * 86400) + (Number(match[2] || 0) * 3600) + (Number(match[3] || 0) * 60) + Number(match[4] || 0);
}

export async function importYouTubeChannel(channelKey = 'oshioma', reset = false): Promise<YouTubeImportResult> {
  const key = process.env.YOUTUBE_API_KEY;
  if (!key) throw new Error('YOUTUBE_API_KEY is not configured');
  type Channels={items?:Array<{id:string;snippet?:{title?:string};contentDetails:{relatedPlaylists:{uploads:string}}}>};
  type Playlist={nextPageToken?:string;items?:Array<{contentDetails:{videoId:string}}>};
  type Videos={items?:Array<{id:string;snippet:{title:string;description?:string;publishedAt?:string;thumbnails?:Record<string,{url:string}>};contentDetails?:{duration?:string}}>};
  type ImportState={channel_id:string|null;uploads_playlist_id:string|null;last_page_token:string|null;status:string;video_count:number};
  let state=await queryOne<ImportState>(`select channel_id,uploads_playlist_id,last_page_token,status,video_count from youtube_channel_imports where channel_key=$1`,[channelKey]);
  let channelId='',uploadsPlaylistId='';
  if(channelKey.startsWith('UC')){channelId=channelKey;const c=await yt<Channels>(`channels?part=snippet,contentDetails&id=${encodeURIComponent(channelId)}`,key);uploadsPlaylistId=c.items?.[0]?.contentDetails.relatedPlaylists.uploads||''}
  else{const c=await yt<Channels>(`channels?part=snippet,contentDetails&forUsername=${encodeURIComponent(channelKey)}`,key);const exact=c.items?.[0];channelId=exact?.id||'';uploadsPlaylistId=exact?.contentDetails.relatedPlaylists.uploads||''}
  if(!channelId)throw new Error(`Exact YouTube channel not found for username: ${channelKey}`);if(!uploadsPlaylistId)throw new Error('Uploads playlist not available');
  if(state?.channel_id&&state.channel_id!==channelId){await query(`delete from artist_videos v where v.youtube_channel_id=$1 and v.status='draft' and v.is_interview=false and v.transcript_status='missing' and not exists(select 1 from artist_video_moments m where m.video_id=v.id)`,[state.channel_id]);reset=true;state=null}
  if(!state||reset){await query(`insert into youtube_channel_imports(channel_key,channel_id,uploads_playlist_id,status,last_page_token,video_count) values($1,$2,$3,'syncing',null,0) on conflict(channel_key) do update set channel_id=excluded.channel_id,uploads_playlist_id=excluded.uploads_playlist_id,status='syncing',last_page_token=null,video_count=0,last_error=null,updated_at=now()`,[channelKey,channelId,uploadsPlaylistId]);state={channel_id:channelId,uploads_playlist_id:uploadsPlaylistId,last_page_token:null,status:'syncing',video_count:0}}
  else if(state.status!=='syncing'){await query(`update youtube_channel_imports set status='syncing',last_page_token=null,last_error=null,updated_at=now() where channel_key=$1`,[channelKey]);state.last_page_token=null}
  const pageToken=state.last_page_token||'';
  try{const p=await yt<Playlist>(`playlistItems?part=contentDetails&maxResults=50&playlistId=${encodeURIComponent(uploadsPlaylistId)}${pageToken?`&pageToken=${encodeURIComponent(pageToken)}`:''}`,key);const ids=(p.items||[]).map(i=>i.contentDetails.videoId).filter(Boolean);let imported=0,updated=0;
    if(ids.length){const existing=await query<{youtube_video_id:string}>(`select youtube_video_id from artist_videos where youtube_video_id=any($1::text[])`,[ids]);const existingIds=new Set(existing.map(r=>r.youtube_video_id));imported=ids.filter(id=>!existingIds.has(id)).length;updated=ids.length-imported;const detail=await yt<Videos>(`videos?part=snippet,contentDetails&id=${encodeURIComponent(ids.join(','))}`,key);const videos=detail.items||[];
      if(videos.length){const values:unknown[]=[];const tuples=videos.map((v,i)=>{const thumb=v.snippet.thumbnails?.maxres?.url||v.snippet.thumbnails?.high?.url||v.snippet.thumbnails?.medium?.url||null;const offset=i*9;values.push(v.id,channelId,v.snippet.title,v.snippet.description||null,thumb,v.snippet.publishedAt||null,parseYouTubeDuration(v.contentDetails?.duration),`https://www.youtube.com/watch?v=${v.id}`,true);return `($${offset+1},$${offset+2},$${offset+3},$${offset+4},$${offset+5},$${offset+6},$${offset+7},$${offset+8},$${offset+9})`});await query(`insert into artist_videos(youtube_video_id,youtube_channel_id,title,description,thumbnail_url,published_at,duration_seconds,source_url,is_guestlist_original) values ${tuples.join(',')} on conflict(youtube_video_id) do update set youtube_channel_id=excluded.youtube_channel_id,title=excluded.title,description=excluded.description,thumbnail_url=excluded.thumbnail_url,published_at=excluded.published_at,duration_seconds=excluded.duration_seconds,updated_at=now()`,values);await query(`insert into artist_video_artists(video_id,artist_id,role,confidence,source) select v.id,a.id,'interviewee',80,'title_match' from artist_videos v join artists a on length(a.name)>=3 and (v.title||' '||coalesce(v.description,'')) ilike '%'||a.name||'%' where v.youtube_video_id=any($1::text[]) on conflict do nothing`,[ids])}}
    const nextPageToken=p.nextPageToken||null,done=!nextPageToken;await query(`update youtube_channel_imports set status=$2,last_synced_at=case when $2='ready' then now() else last_synced_at end,last_page_token=$3,video_count=video_count+$4,last_error=null,updated_at=now() where channel_key=$1`,[channelKey,done?'ready':'syncing',nextPageToken,ids.length]);return {imported,updated,processed:ids.length,channelId,uploadsPlaylistId,done,nextPageToken}
  }catch(e){await query(`update youtube_channel_imports set status='failed',last_error=$2,updated_at=now() where channel_key=$1`,[channelKey,e instanceof Error?e.message:'Unknown error']);throw e}
}
