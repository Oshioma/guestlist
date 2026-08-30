// Person-to-person CONNECTIONS — distinct from follows (promoter/artist/
// venue) and layered over Club Messenger's mutual-follow friendship.
// pending → connected / declined. Blocking is unilateral, immediate, and
// excludes both members from each other's social surfaces everywhere.

import { query, queryOne } from './db';
import { getPrivacy } from './privacy';

export type ConnectionStatus = 'none' | 'pending_out' | 'pending_in' | 'connected' | 'declined' | 'blocked';

export async function isBlockedEitherWay(a: string, b: string): Promise<boolean> {
  const row = await queryOne(
    `select 1 from member_blocks
      where (blocker_id = $1 and blocked_id = $2) or (blocker_id = $2 and blocked_id = $1)`,
    [a, b]
  );
  return !!row;
}

// SQL fragment: no block in either direction between $viewer and member
// alias m. Inline everywhere people are shown to people.
export function notBlockedSql(viewer: string, m = 'm'): string {
  return `not exists (select 1 from member_blocks b
            where (b.blocker_id = ${viewer} and b.blocked_id = ${m}.id)
               or (b.blocker_id = ${m}.id and b.blocked_id = ${viewer}))`;
}

// SQL fragment: $viewer and member alias m have an accepted connection.
export function connectedSql(viewer: string, m = 'm'): string {
  return `exists (select 1 from member_connections c
            where c.status = 'connected'
              and ((c.requester_id = ${viewer} and c.addressee_id = ${m}.id)
                or (c.requester_id = ${m}.id and c.addressee_id = ${viewer})))`;
}

export async function connectionBetween(viewerId: string, otherId: string): Promise<ConnectionStatus> {
  if (await isBlockedEitherWay(viewerId, otherId)) return 'blocked';
  const row = await queryOne<{ requester_id: string; status: string }>(
    `select requester_id, status from member_connections
      where least(requester_id, addressee_id) = least($1::uuid, $2::uuid)
        and greatest(requester_id, addressee_id) = greatest($1::uuid, $2::uuid)`,
    [viewerId, otherId]
  );
  if (!row) return 'none';
  if (row.status === 'connected') return 'connected';
  if (row.status === 'declined') return 'declined';
  return row.requester_id === viewerId ? 'pending_out' : 'pending_in';
}

export async function connectionIds(memberId: string): Promise<string[]> {
  const rows = await query<{ id: string }>(
    `select case when requester_id = $1 then addressee_id else requester_id end as id
       from member_connections
      where status = 'connected' and (requester_id = $1 or addressee_id = $1)`,
    [memberId]
  );
  return rows.map((r) => r.id);
}

export class ConnectionError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export async function requestConnection(fromId: string, toId: string): Promise<void> {
  if (fromId === toId) throw new ConnectionError(400, 'You cannot connect with yourself');
  if (await isBlockedEitherWay(fromId, toId)) throw new ConnectionError(403, 'Not available');
  const target = await queryOne(`select 1 from members where id = $1`, [toId]);
  if (!target) throw new ConnectionError(404, 'Member not found');
  const privacy = await getPrivacy(toId);
  if (!privacy.allow_connection_requests) {
    throw new ConnectionError(403, 'This member is not accepting connection requests');
  }
  const existing = await queryOne<{ id: string; status: string; requester_id: string }>(
    `select id, status, requester_id from member_connections
      where least(requester_id, addressee_id) = least($1::uuid, $2::uuid)
        and greatest(requester_id, addressee_id) = greatest($1::uuid, $2::uuid)`,
    [fromId, toId]
  );
  if (existing?.status === 'connected') throw new ConnectionError(400, 'Already connected');
  if (existing?.status === 'pending') {
    if (existing.requester_id === fromId) throw new ConnectionError(400, 'Request already sent');
    // The other person already asked — treat this as an acceptance.
    await query(
      `update member_connections set status = 'connected', responded_at = now() where id = $1`,
      [existing.id]
    );
    return;
  }
  if (existing) {
    // A declined pair can try again later; the new request flips direction.
    await query(
      `update member_connections
          set requester_id = $2, addressee_id = $3, status = 'pending',
              created_at = now(), responded_at = null
        where id = $1`,
      [existing.id, fromId, toId]
    );
    return;
  }
  await query(
    `insert into member_connections (requester_id, addressee_id) values ($1, $2)`,
    [fromId, toId]
  );
}

export async function respondToConnection(
  memberId: string,
  connectionId: string,
  accept: boolean
): Promise<void> {
  const row = await queryOne(
    `update member_connections
        set status = $3, responded_at = now()
      where id = $1 and addressee_id = $2 and status = 'pending'
      returning id`,
    [connectionId, memberId, accept ? 'connected' : 'declined']
  );
  if (!row) throw new ConnectionError(404, 'Request not found');
}

export async function blockMember(blockerId: string, blockedId: string): Promise<void> {
  if (blockerId === blockedId) throw new ConnectionError(400, 'Invalid');
  await query(
    `insert into member_blocks (blocker_id, blocked_id) values ($1, $2)
     on conflict do nothing`,
    [blockerId, blockedId]
  );
  // Blocking severs any existing connection and any pending request.
  await query(
    `delete from member_connections
      where least(requester_id, addressee_id) = least($1::uuid, $2::uuid)
        and greatest(requester_id, addressee_id) = greatest($1::uuid, $2::uuid)`,
    [blockerId, blockedId]
  );
  // And any member↔member follows (a blocked member is not a friend).
  await query(
    `delete from member_follows
      where entity_type = 'member'
        and ((member_id = $1 and entity_id = $2) or (member_id = $2 and entity_id = $1))`,
    [blockerId, blockedId]
  );
}

export async function unblockMember(blockerId: string, blockedId: string): Promise<void> {
  await query(
    `delete from member_blocks where blocker_id = $1 and blocked_id = $2`,
    [blockerId, blockedId]
  );
}

export type ConnectionRow = {
  connection_id: string;
  member_id: string;
  display_name: string;
  avatar_url: string | null;
  slug: string | null;
  home_city: string | null;
  status: string;
  direction: 'in' | 'out';
  created_at: string;
};

export async function listConnections(memberId: string): Promise<{
  connected: ConnectionRow[];
  pendingIn: ConnectionRow[];
  pendingOut: ConnectionRow[];
}> {
  const rows = await query<ConnectionRow>(
    `select c.id as connection_id, m.id as member_id, m.display_name, m.avatar_url,
            m.slug, m.home_city, c.status,
            case when c.requester_id = $1 then 'out' else 'in' end as direction,
            c.created_at::text
       from member_connections c
       join members m on m.id = case when c.requester_id = $1 then c.addressee_id else c.requester_id end
      where (c.requester_id = $1 or c.addressee_id = $1) and c.status in ('connected', 'pending')
      order by c.created_at desc`,
    [memberId]
  );
  return {
    connected: rows.filter((r) => r.status === 'connected'),
    pendingIn: rows.filter((r) => r.status === 'pending' && r.direction === 'in'),
    pendingOut: rows.filter((r) => r.status === 'pending' && r.direction === 'out'),
  };
}
