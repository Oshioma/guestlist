import { query } from './db';

// Title matching is intentionally conservative. Short artist names are far more
// likely to collide with ordinary words in old YouTube titles/descriptions.
// We keep those artists available for manual assignment, but never trust an
// automatic title_match link shorter than 6 characters.
export async function removeUnsafeAutoArtistMatches(videoIds?: string[]) {
  const params: unknown[] = [];
  let videoFilter = '';
  if (videoIds?.length) {
    params.push(videoIds);
    videoFilter = ` and va.video_id = any($1::uuid[])`;
  }
  const removed = await query<{video_id:string;artist_id:string}>(
    `delete from artist_video_artists va
      using artists a
      where a.id = va.artist_id
        and va.source = 'title_match'
        and length(trim(a.name)) < 6
        ${videoFilter}
      returning va.video_id, va.artist_id`,
    params
  );
  return removed.length;
}

export async function removeUnsafeAutoArtistMatchesForYouTubeIds(youtubeIds: string[]) {
  if (!youtubeIds.length) return 0;
  const rows = await query<{id:string}>(`select id from artist_videos where youtube_video_id = any($1::text[])`,[youtubeIds]);
  return removeUnsafeAutoArtistMatches(rows.map(r=>r.id));
}
