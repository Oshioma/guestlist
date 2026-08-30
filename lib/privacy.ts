// Member privacy + email preference access. No row = defaults. Every
// surface that shows one member's data to another goes through these flags
// — recommendation explanations may only use mutually visible signals.

import { query, queryOne } from './db';

export type MemberPrivacy = {
  profile_public: boolean;
  show_taste: boolean;
  show_history: boolean;
  show_history_years: boolean;
  show_home_city: boolean;
  show_going: boolean;
  scene_discovery: boolean;
  allow_connection_requests: boolean;
};

export const PRIVACY_DEFAULTS: MemberPrivacy = {
  profile_public: true,
  show_taste: true,
  show_history: true,
  show_history_years: true,
  show_home_city: true,
  show_going: true,
  scene_discovery: true,
  allow_connection_requests: true,
};

export async function getPrivacy(memberId: string): Promise<MemberPrivacy> {
  const row = await queryOne<MemberPrivacy>(
    `select profile_public, show_taste, show_history, show_history_years,
            show_home_city, show_going, scene_discovery, allow_connection_requests
       from member_privacy where member_id = $1`,
    [memberId]
  );
  return row ?? PRIVACY_DEFAULTS;
}

export async function updatePrivacy(memberId: string, patch: Partial<MemberPrivacy>): Promise<MemberPrivacy> {
  const current = await getPrivacy(memberId);
  const next: MemberPrivacy = { ...current };
  for (const key of Object.keys(PRIVACY_DEFAULTS) as (keyof MemberPrivacy)[]) {
    if (typeof patch[key] === 'boolean') next[key] = patch[key]!;
  }
  await query(
    `insert into member_privacy (member_id, profile_public, show_taste, show_history,
       show_history_years, show_home_city, show_going, scene_discovery, allow_connection_requests)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     on conflict (member_id) do update set
       profile_public=$2, show_taste=$3, show_history=$4, show_history_years=$5,
       show_home_city=$6, show_going=$7, scene_discovery=$8, allow_connection_requests=$9,
       updated_at=now()`,
    [memberId, next.profile_public, next.show_taste, next.show_history, next.show_history_years,
     next.show_home_city, next.show_going, next.scene_discovery, next.allow_connection_requests]
  );
  return next;
}

// SQL fragment: member alias m is discoverable in people surfaces
// (profile public + scene discovery on, defaults when no row).
export function discoverableSql(m = 'm'): string {
  return `coalesce((select mp.profile_public and mp.scene_discovery
                      from member_privacy mp where mp.member_id = ${m}.id), true)`;
}

// SQL fragment: member alias m appears in Who's Going lists.
export function goingVisibleSql(m = 'm'): string {
  return `coalesce((select mp.profile_public and mp.show_going
                      from member_privacy mp where mp.member_id = ${m}.id), true)`;
}

export type MemberEmailPrefs = {
  followed_promoter_events: boolean;
  followed_venue_events: boolean;
  followed_artist_events: boolean;
  genre_in_home_city: boolean;
  travel_events: boolean;
  connection_going: boolean;
  weekly_digest: boolean;
};

export const EMAIL_PREF_DEFAULTS: MemberEmailPrefs = {
  followed_promoter_events: true,
  followed_venue_events: true,
  followed_artist_events: true,
  genre_in_home_city: false,
  travel_events: true,
  connection_going: false,
  weekly_digest: true,
};

export async function getEmailPrefs(memberId: string): Promise<MemberEmailPrefs> {
  const row = await queryOne<MemberEmailPrefs>(
    `select followed_promoter_events, followed_venue_events, followed_artist_events,
            genre_in_home_city, travel_events, connection_going, weekly_digest
       from member_email_prefs where member_id = $1`,
    [memberId]
  );
  return row ?? EMAIL_PREF_DEFAULTS;
}

export async function updateEmailPrefs(memberId: string, patch: Partial<MemberEmailPrefs>): Promise<MemberEmailPrefs> {
  const current = await getEmailPrefs(memberId);
  const next: MemberEmailPrefs = { ...current };
  for (const key of Object.keys(EMAIL_PREF_DEFAULTS) as (keyof MemberEmailPrefs)[]) {
    if (typeof patch[key] === 'boolean') next[key] = patch[key]!;
  }
  await query(
    `insert into member_email_prefs (member_id, followed_promoter_events, followed_venue_events,
       followed_artist_events, genre_in_home_city, travel_events, connection_going, weekly_digest)
     values ($1,$2,$3,$4,$5,$6,$7,$8)
     on conflict (member_id) do update set
       followed_promoter_events=$2, followed_venue_events=$3, followed_artist_events=$4,
       genre_in_home_city=$5, travel_events=$6, connection_going=$7, weekly_digest=$8,
       updated_at=now()`,
    [memberId, next.followed_promoter_events, next.followed_venue_events, next.followed_artist_events,
     next.genre_in_home_city, next.travel_events, next.connection_going, next.weekly_digest]
  );
  return next;
}
