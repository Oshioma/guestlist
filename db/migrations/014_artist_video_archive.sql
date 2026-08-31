-- Guestlist Artist Video Archive — original interviews as first-class cultural data.

create type artist_video_status as enum ('draft', 'review', 'published', 'hidden');
create type video_transcript_status as enum ('missing', 'partial', 'ready', 'failed');

create table artist_videos (
  id uuid primary key default gen_random_uuid(),
  youtube_video_id text not null unique,
  youtube_channel_id text,
  title text not null,
  description text,
  thumbnail_url text,
  published_at timestamptz,
  duration_seconds integer check (duration_seconds is null or duration_seconds >= 0),
  language text,
  source_url text not null,
  status artist_video_status not null default 'draft',
  is_interview boolean not null default false,
  is_guestlist_original boolean not null default true,
  transcript_text text,
  transcript_status video_transcript_status not null default 'missing',
  transcript_source text check (transcript_source is null or transcript_source in ('manual', 'youtube_captions', 'import', 'ai_transcription')),
  imported_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references members(id) on delete set null
);

create index artist_videos_status_published_idx on artist_videos(status, published_at desc);
create index artist_videos_interview_idx on artist_videos(is_interview, status);

create table artist_video_artists (
  video_id uuid not null references artist_videos(id) on delete cascade,
  artist_id uuid not null references artists(id) on delete cascade,
  role text not null default 'interviewee' check (role in ('interviewee', 'featured', 'mentioned')),
  confidence numeric(5,2) check (confidence is null or (confidence >= 0 and confidence <= 100)),
  source text not null default 'admin' check (source in ('admin', 'title_match', 'ai')),
  primary key (video_id, artist_id, role)
);

create index artist_video_artists_artist_idx on artist_video_artists(artist_id, video_id);

create table artist_video_moments (
  id uuid primary key default gen_random_uuid(),
  video_id uuid not null references artist_videos(id) on delete cascade,
  start_seconds integer not null check (start_seconds >= 0),
  end_seconds integer check (end_seconds is null or end_seconds > start_seconds),
  title text not null,
  summary text,
  transcript_excerpt text,
  topic_slug text,
  topic_label text,
  status artist_video_status not null default 'review',
  confidence numeric(5,2) check (confidence is null or (confidence >= 0 and confidence <= 100)),
  source text not null default 'admin' check (source in ('admin', 'ai')),
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(video_id, start_seconds, title)
);

create index artist_video_moments_video_idx on artist_video_moments(video_id, start_seconds);
create index artist_video_moments_topic_idx on artist_video_moments(topic_slug, status);

create table artist_video_moment_entities (
  moment_id uuid not null references artist_video_moments(id) on delete cascade,
  entity_type text not null check (entity_type in ('artist','venue','promoter','genre','scene_entity','archive_event')),
  entity_id uuid not null,
  primary key (moment_id, entity_type, entity_id)
);

-- Import/sync state kept separately so the catalogue can be refreshed idempotently.
create table youtube_channel_imports (
  id uuid primary key default gen_random_uuid(),
  channel_key text not null unique,
  channel_id text,
  uploads_playlist_id text,
  last_synced_at timestamptz,
  last_page_token text,
  video_count integer not null default 0,
  status text not null default 'idle' check (status in ('idle','syncing','ready','failed')),
  last_error text,
  updated_at timestamptz not null default now()
);

-- Public video data is intentionally read-only. Admin writes go through server routes.
alter table artist_videos enable row level security;
alter table artist_video_artists enable row level security;
alter table artist_video_moments enable row level security;
alter table artist_video_moment_entities enable row level security;
alter table youtube_channel_imports enable row level security;

create policy artist_videos_public_read on artist_videos for select using (status = 'published');
create policy artist_video_artists_public_read on artist_video_artists for select using (
  exists (select 1 from artist_videos v where v.id = video_id and v.status = 'published')
);
create policy artist_video_moments_public_read on artist_video_moments for select using (
  status = 'published' and exists (select 1 from artist_videos v where v.id = video_id and v.status = 'published')
);
create policy artist_video_moment_entities_public_read on artist_video_moment_entities for select using (
  exists (
    select 1 from artist_video_moments m join artist_videos v on v.id = m.video_id
    where m.id = moment_id and m.status = 'published' and v.status = 'published'
  )
);

-- Service/server-side admin uses the normal app DB role. Keep grants portable.
grant select on artist_videos, artist_video_artists, artist_video_moments, artist_video_moment_entities to public;
