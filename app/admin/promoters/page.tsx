// ADMIN → PROMOTERS: claim review queue + promoter account control +
// pending event-association claims.

import Link from 'next/link';
import { query } from '@/lib/db';
import { fmtDate } from '@/lib/util';
import { ClaimDecision, EventClaimDecision, PromoterSuspend } from '@/components/admin/ClaimDecision';

export const dynamic = 'force-dynamic';

export default async function AdminPromotersPage() {
  const [claims, eventClaims, promoters] = await Promise.all([
    query<{
      id: string; status: string; claimant_name: string; claimant_role: string | null;
      email: string; phone: string | null; website: string | null; notes: string | null;
      domain_match: boolean; created_at: string; admin_note: string | null;
      promoter_id: string; promoter_name: string; promoter_slug: string;
      promoter_website: string | null; promoter_claim_status: string;
      member_name: string; member_email: string;
    }>(
      `select c.id, c.status, c.claimant_name, c.claimant_role, c.email, c.phone, c.website,
              c.notes, c.domain_match, c.created_at::text, c.admin_note,
              p.id as promoter_id, p.name as promoter_name, p.slug as promoter_slug,
              p.website as promoter_website, p.claim_status as promoter_claim_status,
              m.display_name as member_name, m.email as member_email
         from promoter_claims c
         join promoters p on p.id = c.promoter_id
         join members m on m.id = c.member_id
        order by (c.status in ('pending', 'info_requested')) desc, c.created_at desc
        limit 60`
    ),
    query<{
      id: string; created_at: string; evidence: string | null;
      event_title: string; event_slug: string; promoter_name: string;
    }>(
      `select ec.id, ec.created_at::text, ec.evidence,
              e.title as event_title, e.slug as event_slug, p.name as promoter_name
         from event_claims ec
         join events e on e.id = ec.event_id
         join promoters p on p.id = ec.promoter_id
        where ec.status = 'pending'
        order by ec.created_at desc limit 30`
    ),
    query<{ id: string; name: string; slug: string; claim_status: string; verified: boolean; team: number }>(
      `select p.id, p.name, p.slug, p.claim_status, p.verified,
              (select count(*)::int from promoter_members pm where pm.promoter_id = p.id) as team
         from promoters p
        where p.claim_status in ('verified', 'suspended')
        order by p.name`
    ),
  ]);

  const open = claims.filter((c) => c.status === 'pending' || c.status === 'info_requested');
  const closed = claims.filter((c) => c.status !== 'pending' && c.status !== 'info_requested');

  return (
    <main>
      <h1 className="adminTitle">Promoters</h1>
      <p className="adminSub">Profile claims, event claims, and account control.</p>

      <div className="sectionLabel">Claims to review ({open.length})</div>
      {open.length === 0 && <p className="adminSub">Nothing waiting.</p>}
      {open.map((c) => (
        <div className="reviewCard" key={c.id} style={{ gridTemplateColumns: 'minmax(0,1fr) auto' }}>
          <div>
            <h3>
              <Link href={`/promoters/${c.promoter_slug}`} style={{ textDecoration: 'underline' }}>
                {c.promoter_name}
              </Link>
              {c.status === 'info_requested' && (
                <span className="confidencePill" style={{ marginLeft: 10 }}>info requested</span>
              )}
            </h3>
            <div className="facts">
              <span>Claimant: <b>{c.claimant_name}</b>{c.claimant_role && ` (${c.claimant_role})`}</span>
              <span>Email: <b>{c.email}</b></span>
              {c.phone && <span>Phone: <b>{c.phone}</b></span>}
              <span>Account: <b>{c.member_name}</b> ({c.member_email})</span>
              <span>Claimed: <b>{fmtDate(c.created_at, 'Europe/London', { day: 'numeric', month: 'short' })}</b></span>
              {c.promoter_website && (
                <span>Official site: <a href={c.promoter_website} target="_blank" rel="noopener noreferrer" style={{ textDecoration: 'underline' }}>{c.promoter_website}</a></span>
              )}
              {c.website && c.website !== c.promoter_website && (
                <span>Supplied site: <a href={c.website} target="_blank" rel="noopener noreferrer" style={{ textDecoration: 'underline' }}>{c.website}</a></span>
              )}
            </div>
            <div style={{ marginTop: 8 }}>
              {c.domain_match ? (
                <span className="evChip green">✓ email matches official domain</span>
              ) : (
                <span className="evChip amber">no domain match — check manually</span>
              )}
            </div>
            {c.notes && <div className="warnList" style={{ color: 'var(--text-muted)' }}>“{c.notes}”</div>}
          </div>
          <div className="actions">
            <ClaimDecision claimId={c.id} />
          </div>
        </div>
      ))}

      {eventClaims.length > 0 && (
        <>
          <div className="sectionLabel" style={{ marginTop: 30 }}>Event claims to review</div>
          {eventClaims.map((ec) => (
            <div className="attentionRow" key={ec.id}>
              <span>
                <b>{ec.promoter_name}</b> claims{' '}
                <Link href={`/events/${ec.event_slug}`} style={{ textDecoration: 'underline' }}>{ec.event_title}</Link>
                {ec.evidence && <span style={{ color: 'var(--text-faint)' }}> — “{ec.evidence}”</span>}
              </span>
              <EventClaimDecision claimId={ec.id} />
            </div>
          ))}
        </>
      )}

      <div className="sectionLabel" style={{ marginTop: 30 }}>Verified promoter accounts</div>
      {promoters.length === 0 && <p className="adminSub">None yet.</p>}
      {promoters.map((p) => (
        <div className="attentionRow" key={p.id}>
          <span>
            <Link href={`/promoters/${p.slug}`} style={{ textDecoration: 'underline' }}><b>{p.name}</b></Link>{' '}
            <span style={{ color: 'var(--text-faint)', fontSize: 12 }}>{p.team} team member{p.team === 1 ? '' : 's'}</span>
            {p.claim_status === 'suspended' && (
              <span className="evChip red" style={{ marginLeft: 8 }}>suspended</span>
            )}
          </span>
          <PromoterSuspend promoterId={p.id} suspended={p.claim_status === 'suspended'} />
        </div>
      ))}

      {closed.length > 0 && (
        <>
          <div className="sectionLabel" style={{ marginTop: 30 }}>Claim history</div>
          {closed.slice(0, 15).map((c) => (
            <div className="attentionRow" key={c.id}>
              <span>{c.promoter_name} — {c.claimant_name} ({c.email})</span>
              <span className={`evChip ${c.status === 'approved' ? 'green' : 'red'}`}>{c.status}</span>
            </div>
          ))}
        </>
      )}
    </main>
  );
}
