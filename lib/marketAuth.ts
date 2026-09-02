// Business portal authorisation — the promoter_members pattern, applied to
// Guestlist Market. One account can run several businesses; a business can
// have several people. Permissions are enforced here, server-side, never by
// a hidden button. No second login system: a business owner is a member.

import { AuthError, getCurrentMember, type Member } from './auth';
import { query, queryOne } from './db';

export type BusinessRole = 'owner' | 'editor';

const ROLE_RANK: Record<BusinessRole, number> = { owner: 2, editor: 1 };

export type BusinessMembership = { id: string; name: string; slug: string; role: BusinessRole; status: string };

export async function getMemberBusinesses(memberId: string): Promise<BusinessMembership[]> {
  return query<BusinessMembership>(
    `select b.id, b.name, b.slug, bm.role, b.status
       from market_business_members bm join market_businesses b on b.id = bm.business_id
      where bm.member_id = $1 order by bm.created_at`,
    [memberId]
  );
}

export type BusinessContext = {
  member: Member;
  role: BusinessRole;
  business: { id: string; name: string; slug: string; status: string };
};

// Reads survive any status (an applicant can see their own application);
// writes need the business to be approved unless allowUnapproved is set
// (editing an application before it is decided).
export async function requireBusinessRole(
  businessId: string,
  minRole: BusinessRole,
  opts: { allowUnapproved?: boolean } = {}
): Promise<BusinessContext> {
  const member = await getCurrentMember();
  if (!member) throw new AuthError(401, 'Sign in required');
  const row = await queryOne<{ role: BusinessRole; id: string; name: string; slug: string; status: string }>(
    `select bm.role, b.id, b.name, b.slug, b.status
       from market_business_members bm join market_businesses b on b.id = bm.business_id
      where bm.business_id = $1 and bm.member_id = $2`,
    [businessId, member.id]
  );
  if (!row) throw new AuthError(403, 'You don’t manage this business');
  if (ROLE_RANK[row.role] < ROLE_RANK[minRole]) throw new AuthError(403, `Requires ${minRole} access`);
  if (!opts.allowUnapproved && row.status !== 'approved' && row.status !== 'paused') {
    throw new AuthError(403, 'This business isn’t in the Market yet');
  }
  return { member, role: row.role, business: { id: row.id, name: row.name, slug: row.slug, status: row.status } };
}

export type BusinessDashContext =
  | { kind: 'anon' }
  | { kind: 'none'; member: Member }
  | { kind: 'ok'; member: Member; businesses: BusinessMembership[]; active: BusinessMembership };

export async function businessDashContext(preferredId?: string | null): Promise<BusinessDashContext> {
  const member = await getCurrentMember();
  if (!member) return { kind: 'anon' };
  const businesses = await getMemberBusinesses(member.id);
  if (!businesses.length) return { kind: 'none', member };
  const active = businesses.find((b) => b.id === preferredId) ?? businesses[0];
  return { kind: 'ok', member, businesses, active };
}
