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
  event_reminders: boolean;
  alert_frequency: 'instant' | 'daily' | 'weekly' | 'off';
  close_friend_activity: 'on' | 'digest' | 'off';
  promoter_announcements: 'email' | 'inapp' | 'off';
};

export const EMAIL_PREF_DEFAULTS: MemberEmailPrefs = {
  followed_promoter_events: true,
  followed_venue_events: true,
  followed_artist_events: true,
  genre_in_home_city: false,
  travel_events: true,
  connection_going: false,
  weekly_digest: true,
  event_reminders: true,
  // Conservative default: high-intent follows land in a daily digest, not
  // instant email; members opt IN to as-it-happens.
  alert_frequency: 'daily',
  // Close friends default ON (that is the point of marking one); promoter
  // announcements default to in-app only — email is an explicit opt-in.
  close_friend_activity: 'on',
  promoter_announcements: 'inapp',
};

export async function getEmailPrefs(memberId: string): Promise<MemberEmailPrefs> {
  const row = await queryOne<MemberEmailPrefs>(
    `select followed_promoter_events, followed_venue_events, followed_artist_events,
            genre_in_home_city, travel_events, connection_going, weekly_digest,
            event_reminders, alert_frequency, close_friend_activity, promoter_announcements
       from member_email_prefs where member_id = $1`,
    [memberId]
  );
  return row ?? EMAIL_PREF_DEFAULTS;
}

export async function updateEmailPrefs(memberId: string, patch: Partial<MemberEmailPrefs>): Promise<MemberEmailPrefs> {
  const current = await getEmailPrefs(memberId);
  const next: MemberEmailPrefs = { ...current };
  for (const key of Object.keys(EMAIL_PREF_DEFAULTS) as (keyof MemberEmailPrefs)[]) {
    if (key === 'alert_frequency' || key === 'close_friend_activity' || key === 'promoter_announcements') continue;
    if (typeof patch[key] === 'boolean') (next as Record<string, unknown>)[key] = patch[key];
  }
  if (patch.alert_frequency && ['instant', 'daily', 'weekly', 'off'].includes(patch.alert_frequency)) {
    next.alert_frequency = patch.alert_frequency;
  }
  if (patch.close_friend_activity && ['on', 'digest', 'off'].includes(patch.close_friend_activity)) {
    next.close_friend_activity = patch.close_friend_activity;
  }
  if (patch.promoter_announcements && ['email', 'inapp', 'off'].includes(patch.promoter_announcements)) {
    next.promoter_announcements = patch.promoter_announcements;
  }
  await query(
    `insert into member_email_prefs (member_id, followed_promoter_events, followed_venue_events,
       followed_artist_events, genre_in_home_city, travel_events, connection_going, weekly_digest,
       event_reminders, alert_frequency, close_friend_activity, promoter_announcements)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
     on conflict (member_id) do update set
       followed_promoter_events=$2, followed_venue_events=$3, followed_artist_events=$4,
       genre_in_home_city=$5, travel_events=$6, connection_going=$7, weekly_digest=$8,
       event_reminders=$9, alert_frequency=$10, close_friend_activity=$11, promoter_announcements=$12,
       updated_at=now()`,
    [memberId, next.followed_promoter_events, next.followed_venue_events, next.followed_artist_events,
     next.genre_in_home_city, next.travel_events, next.connection_going, next.weekly_digest,
     next.event_reminders, next.alert_frequency, next.close_friend_activity, next.promoter_announcements]
  );
  return next;
}
