// MEMBER DROPS and DOING GOOD — the two parts of the membership that are
// written by people, not derived from data. Drops are surprise tickets,
// last-minute lists, secret parties; good causes are the community projects
// the membership supports. Both ship empty and are filled in by admin.

import { AuthError } from './auth';
import { query, queryOne } from './db';
import { track } from './analytics';

export type Drop = {
  id: string; title: string; body: string | null; event_id: string | null; link_url: string | null;
  places: number | null; starts_at: string; ends_at: string | null; status: 'draft' | 'live' | 'closed';
  event_title: string | null; event_slug: string | null; claims: number;
};

const DROP_COLUMNS = `d.id, d.title, d.body, d.event_id, d.link_url, d.places, d.starts_at::text, d.ends_at::text, d.status,
  e.title as event_title, e.slug as event_slug,
  (select count(*)::int from member_drop_claims k where k.drop_id = d.id and k.status <> 'cancelled') as claims`;

export async function liveDrops(limit = 12): Promise<Drop[]> {
  return query<Drop>(
    `select ${DROP_COLUMNS} from member_drops d left join events e on e.id = d.event_id
      where d.status = 'live' and d.starts_at <= now() and (d.ends_at is null or d.ends_at > now())
      order by d.starts_at desc limit $1`,
    [limit]
  );
}

export async function allDrops(): Promise<Drop[]> {
  return query<Drop>(
    `select ${DROP_COLUMNS} from member_drops d left join events e on e.id = d.event_id
      order by case d.status when 'live' then 0 when 'draft' then 1 else 2 end, d.starts_at desc`
  );
}

export async function memberDropClaims(memberId: string): Promise<Set<string>> {
  const rows = await query<{ drop_id: string }>(
    `select drop_id from member_drop_claims where member_id = $1 and status <> 'cancelled'`, [memberId]);
  return new Set(rows.map((r) => r.drop_id));
}

export async function claimDrop(memberId: string, dropId: string): Promise<'claimed' | 'already' | 'full'> {
  const d = await queryOne<{ id: string; places: number | null; claims: number; live: boolean }>(
    `select d.id, d.places,
            (select count(*)::int from member_drop_claims k where k.drop_id = d.id and k.status <> 'cancelled') as claims,
            (d.status = 'live' and d.starts_at <= now() and (d.ends_at is null or d.ends_at > now())) as live
       from member_drops d where d.id = $1`,
    [dropId]
  );
  if (!d || !d.live) throw new AuthError(400, 'This drop has finished');
  if (d.places != null && d.claims >= d.places) return 'full';
  const row = await queryOne<{ id: string }>(
    `insert into member_drop_claims (drop_id, member_id) values ($1, $2) on conflict (drop_id, member_id) do nothing returning id`,
    [dropId, memberId]
  );
  if (!row) return 'already';
  await track('member_drop_claimed', { memberId, metadata: { drop_id: dropId } });
  return 'claimed';
}

export type GoodCause = {
  id: string; title: string; slug: string; summary: string | null; body: string | null;
  image_url: string | null; link_url: string | null; status: string; sort_order: number;
};

export async function liveGoodCauses(): Promise<GoodCause[]> {
  return query<GoodCause>(
    `select id, title, slug, summary, body, image_url, link_url, status, sort_order
       from good_causes where status in ('live', 'completed') order by status, sort_order, title`
  );
}

export async function allGoodCauses(): Promise<GoodCause[]> {
  return query<GoodCause>(
    `select id, title, slug, summary, body, image_url, link_url, status, sort_order from good_causes
      order by case status when 'live' then 0 when 'draft' then 1 when 'completed' then 2 else 3 end, sort_order, title`
  );
}
