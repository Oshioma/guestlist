// Shared context resolution for the promoter dashboard pages.

import { getCurrentMember, type Member } from './auth';
import { queryOne } from './db';
import { getMemberPromoters, type PromoterRole } from './promoterAuth';

export type ActivePromoter = {
  id: string;
  name: string;
  slug: string;
  role: PromoterRole;
  claim_status: string;
  verified: boolean;
  website: string | null;
  image_url: string | null;
  description: string | null;
  city: string | null;
  country: string | null;
};

export type DashContext =
  | { kind: 'anon' }
  | { kind: 'none'; member: Member }
  | { kind: 'ok'; member: Member; promoterships: Awaited<ReturnType<typeof getMemberPromoters>>; active: ActivePromoter };

export async function dashContext(preferredId?: string | null): Promise<DashContext> {
  const member = await getCurrentMember();
  if (!member) return { kind: 'anon' };
  const promoterships = await getMemberPromoters(member.id);
  if (!promoterships.length) return { kind: 'none', member };
  const chosen = promoterships.find((p) => p.id === preferredId) ?? promoterships[0];
  const details = await queryOne<Omit<ActivePromoter, 'role'>>(
    `select id, name, slug, claim_status, verified, website, image_url, description, city, country
       from promoters where id = $1`,
    [chosen.id]
  );
  return {
    kind: 'ok',
    member,
    promoterships,
    active: { ...(details as Omit<ActivePromoter, 'role'>), role: chosen.role },
  };
}
