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

export type YouTubeImportResult = { imported: number; updated: number; channelId: string; uploadsPlaylistId: string };

async function yt<T>(path: string, key: string): Promise<T> {
  const sep = path.includes('?') ? '&' : '?';
  const res = await fetch(`https://www.googleapis.com/youtube/v3/${path}${sep}key=${encodeURIComponent(key)}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`YouTube API ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return res.json() as Promise<T>;
}

// Imports metadata only. Guestlist does not download/re-host YouTube video files.
export async function importYouTubeChannel(channelKey = 'oshioma'): Promise<YouTubeImportResult> {
  const key = process.env.YOUTUBE_API_KEY;
  if (!key) throw new Error('YOUTUBE_API_KEY is not configured');

  type Search = { items?: Array<{ id: { channelId?: string } }> };
  type Channels = { items?: Array<{ id: string; contentDetails: { relatedPlaylists: { uploads: string } } }> };
  type Playlist = { nextPageToken?: string; items?: Array<{ contentDetails: { videoId: string } }> };
  type Videos = { items?: Array<{ id: string; snippet: { title: string; description?: string; publishedAt?: string; thumbnails?: Record<string,{url:string}> }; contentDetails?: { duration?: string } }> };

  let channelId = channelKey.startsWith('UC') ? channelKey : '';
  if (!channelId) {
    const s = await yt<Search>(`search?part=snippet&type=channel&maxResults=5&q=${encodeURIComponent(channelKey)}`, key);
    channelId = s.items?.[0]?.id.channelId || '';
  }
  if (!channelId) throw new Error(`YouTube channel not found: ${channelKey}`);
  const c = await yt<Channels>(`channels?part=contentDetails&id=${encodeURIComponent(channelId)}`, key);
  const uploadsPlaylistId = c.items?.[0]?.contentDetails.relatedPlaylists.uploads;
  if (!uploadsPlaylistId) throw new Error('Uploads playlist not available');

  await query(`insert into youtube_channel_imports(channel_key, channel_id, uploads_playlist_id, status)
    values($1,$2,$3,'syncing') on conflict(channel_key) do update set channel_id=excluded.channel_id,
    uploads_playlist_id=excluded.uploads_playlist_id,status='syncing',last_error=null,updated_at=now()`,
    [channelKey, channelId, uploadsPlaylistId]);

  let pageToken = ''; let imported = 0; let updated = 0;
  try {
    do {
      const p = await yt<Playlist>(`playlistItems?part=contentDetails&maxResults=50&playlistId=${encodeURIComponent(uploadsPlaylistId)}${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`, key);
      const ids = (p.items || []).map(i => i.contentDetails.videoId).filter(Boolean);
      if (ids.length) {
        const detail = await yt<Videos>(`videos?part=snippet,contentDetails&id=${encodeURIComponent(ids.join(','))}`, key);
        for (const v of detail.items || []) {
          const existing = await queryOne<{ id: string }>(`select id from artist_videos where youtube_video_id=$1`, [v.id]);
          const thumb = v.snippet.thumbnails?.maxres?.url || v.snippet.thumbnails?.high?.url || v.snippet.thumbnails?.medium?.url || null;
          await query(`insert into artist_videos(youtube_video_id,youtube_channel_id,title,description,thumbnail_url,published_at,source_url,is_guestlist_original)
            values($1,$2,$3,$4,$5,$6,$7,true)
            on conflict(youtube_video_id) do update set title=excluded.title,description=excluded.description,
              thumbnail_url=excluded.thumbnail_url,published_at=excluded.published_at,updated_at=now()`,
            [v.id, channelId, v.snippet.title, v.snippet.description || null, thumb, v.snippet.publishedAt || null, `https://www.youtube.com/watch?v=${v.id}`]);
          const row = await queryOne<{ id: string }>(`select id from artist_videos where youtube_video_id=$1`, [v.id]);
          if (row) await autoMatchArtists(row.id);
          existing ? updated++ : imported++;
        }
      }
      pageToken = p.nextPageToken || '';
    } while (pageToken);
    await query(`update youtube_channel_imports set status='ready',last_synced_at=now(),last_page_token=null,
      video_count=$2,updated_at=now() where channel_key=$1`, [channelKey, imported + updated]);
    return { imported, updated, channelId, uploadsPlaylistId };
  } catch (e) {
    await query(`update youtube_channel_imports set status='failed',last_error=$2,updated_at=now() where channel_key=$1`,
      [channelKey, e instanceof Error ? e.message : 'Unknown error']);
    throw e;
  }
}
