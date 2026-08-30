import { dashContext } from '@/lib/promoterDash';
import { DashShell } from '@/components/promoter/DashShell';
import { TeamManager } from '@/components/promoter/TeamManager';
import { query } from '@/lib/db';
import { roleAtLeast } from '@/lib/promoterAuth';

export const dynamic = 'force-dynamic';

export default async function PromoterTeamPage({
  searchParams,
}: {
  searchParams: Promise<{ p?: string }>;
}) {
  const sp = await searchParams;
  const ctx = await dashContext(sp.p);
  if (ctx.kind !== 'ok' || ctx.active.claim_status !== 'verified') {
    return <DashShell ctx={ctx} tab="/team">{null}</DashShell>;
  }

  const [team, invites] = await Promise.all([
    query<{ member_id: string; display_name: string; email: string; avatar_url: string | null; role: string }>(
      `select pm.member_id, m.display_name, m.email, m.avatar_url, pm.role
         from promoter_members pm join members m on m.id = pm.member_id
        where pm.promoter_id = $1
        order by case pm.role when 'owner' then 0 when 'admin' then 1 when 'editor' then 2 else 3 end, m.display_name`,
      [ctx.active.id]
    ),
    query<{ id: string; email: string; role: string; expires_at: string }>(
      `select id, email, role, expires_at::text from promoter_invites
        where promoter_id = $1 and accepted_at is null and expires_at > now()
        order by created_at desc`,
      [ctx.active.id]
    ),
  ]);

  return (
    <DashShell ctx={ctx} tab="/team">
      <TeamManager
        promoterId={ctx.active.id}
        selfId={ctx.member.id}
        selfRole={ctx.active.role}
        canManage={roleAtLeast(ctx.active.role, 'admin')}
        isOwner={ctx.active.role === 'owner'}
        team={team}
        pendingInvites={invites}
      />
    </DashShell>
  );
}
