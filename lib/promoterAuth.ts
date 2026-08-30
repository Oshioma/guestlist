// Promoter team authorization. One promoter has many team members with
// roles; one account can sit on several teams. Every promoter-facing API
// goes through requirePromoterRole — permissions are enforced server-side,
// never by hidden buttons.

import { AuthError, getCurrentMember, type Member } from './auth';
import { query, queryOne } from './db';

export type PromoterRole = 'owner' | 'admin' | 'editor' | 'analyst';

const ROLE_RANK: Record<PromoterRole, number> = { owner: 4, admin: 3, editor: 2, analyst: 1 };

export function roleAtLeast(role: PromoterRole, min: PromoterRole): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[min];
}

export type PromoterContext = {
  member: Member;
  role: PromoterRole;
  promoter: {
    id: string;
    name: string;
    slug: string;
    website: string | null;
    claim_status: string;
    verified: boolean;
  };
};

export async function getMemberPromoters(memberId: string): Promise<
  { id: string; name: string; slug: string; role: PromoterRole; claim_status: string }[]
> {
  return query(
    `select p.id, p.name, p.slug, pm.role, p.claim_status
       from promoter_members pm join promoters p on p.id = pm.promoter_id
      where pm.member_id = $1
      order by pm.created_at`,
    [memberId]
  ) as Promise<{ id: string; name: string; slug: string; role: PromoterRole; claim_status: string }[]>;
}

// minRole: the weakest role allowed to perform the action.
// Writes additionally require the promoter to be verified and not suspended;
// analysts' read access survives suspension review but writes never do.
export async function requirePromoterRole(
  promoterId: string,
  minRole: PromoterRole,
  opts: { allowSuspended?: boolean } = {}
): Promise<PromoterContext> {
  const member = await getCurrentMember();
  if (!member) throw new AuthError(401, 'Sign in required');

  const row = await queryOne<{
    role: PromoterRole;
    id: string; name: string; slug: string; website: string | null;
    claim_status: string; verified: boolean;
  }>(
    `select pm.role, p.id, p.name, p.slug, p.website, p.claim_status, p.verified
       from promoter_members pm join promoters p on p.id = pm.promoter_id
      where pm.promoter_id = $1 and pm.member_id = $2`,
    [promoterId, member.id]
  );
  if (!row) throw new AuthError(403, 'You are not on this promoter’s team');
  if (!roleAtLeast(row.role, minRole)) {
    throw new AuthError(403, `Requires ${minRole} access`);
  }
  if (row.claim_status === 'suspended' && !opts.allowSuspended) {
    throw new AuthError(403, 'This promoter account is suspended');
  }
  if (row.claim_status !== 'verified' && row.claim_status !== 'suspended') {
    throw new AuthError(403, 'This promoter account is not verified yet');
  }
  return {
    member,
    role: row.role,
    promoter: {
      id: row.id, name: row.name, slug: row.slug,
      website: row.website, claim_status: row.claim_status, verified: row.verified,
    },
  };
}

// Guard that an event belongs to the promoter before any modification.
export async function requireOwnEvent(promoterId: string, eventId: string): Promise<{ id: string; status: string; listing_status: string; title: string }> {
  const event = await queryOne<{ id: string; status: string; listing_status: string; title: string; promoter_id: string | null }>(
    `select id, status, listing_status, title, promoter_id from events where id = $1`,
    [eventId]
  );
  if (!event || event.promoter_id !== promoterId) {
    throw new AuthError(404, 'Event not found for this promoter');
  }
  return event;
}

export function domainOf(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url.includes('://') ? url : `https://${url}`).hostname
      .replace(/^www\./, '')
      .toLowerCase();
  } catch {
    return null;
  }
}

export function emailDomain(email: string): string | null {
  const at = email.lastIndexOf('@');
  return at > 0 ? email.slice(at + 1).toLowerCase() : null;
}
