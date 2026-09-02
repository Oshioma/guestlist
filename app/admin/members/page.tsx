// ADMIN → MEMBERS: who is paying, what it earns, what it costs, and the
// fair-use picture per person. Information for a person — nothing here
// restricts anybody automatically.

import Link from 'next/link';
import { memberLedger, membershipOverview, requestOverview, waitlistRows } from '@/lib/membershipStats';
import { billingEnabled, formatPence } from '@/lib/membership';
import { GrantMembership, RevokeMembership } from '@/components/admin/MembershipControls';
import { VerificationControls } from '@/components/admin/VerificationControls';
import { unverifiedMembers, VERIFY_NUDGE_AFTER_HOURS } from '@/lib/emailVerification';

export const dynamic = 'force-dynamic';

export default async function AdminMembersPage() {
  const [m, r, ledger, waitlist, unverified] = await Promise.all([membershipOverview(), requestOverview(), memberLedger(), waitlistRows(), unverifiedMembers()]);
  const flagged = ledger.filter((x) => x.flags.length > 0);

  return (
    <main>
      <h1 className="adminTitle">Members</h1>
      <p className="adminSub">
        {billingEnabled() ? 'Billing is live through Stripe.' : 'Billing is not switched on yet — the membership page is collecting a waitlist.'}
        {' '}Fair use is a judgement for a person: this page surfaces the numbers. Nothing is restricted automatically.
      </p>

      <div className="statGrid">
        {([
          [String(m.paying), 'Paying members'],
          [String(m.complimentary), 'Complimentary'],
          [formatPence(m.mrr_pence), 'MRR'],
          [formatPence(m.revenue_30d_pence), 'Collected · 30d'],
          [String(m.new_30d), 'New · 30d'],
          [String(m.cancelled_30d), 'Cancelled · 30d'],
          [m.churn_pct == null ? '—' : `${m.churn_pct}%`, 'Churn · 30d'],
          [String(m.past_due), 'Payment failed'],
          [String(m.waitlist), 'On the waitlist'],
          [formatPence(r.cost_30d_pence), 'Fulfilment cost · 30d'],
          [formatPence(r.cost_lifetime_pence), 'Fulfilment cost · all time'],
        ] as [string, string][]).map(([v, l]) => (
          <div className="statTile" key={l}><div className="v" style={{ fontSize: 22 }}>{v}</div><div className="l">{l}</div></div>
        ))}
      </div>

      {/* WHO THE GATE IS HOLDING.
          An unconfirmed member is not listed in the directory and not offered
          to search engines — which is the whole point, and also invisible to
          you unless something says so. This is that something. */}
      <div className="sectionLabel" style={{ marginTop: 30 }}>Not confirmed yet ({unverified.length})</div>
      <p className="adminSub">
        They can sign in and look around, but they are not in the directory and
        not offered to search engines until they confirm their address. Everybody
        gets one reminder after {VERIFY_NUDGE_AFTER_HOURS} hours, automatically.
      </p>
      {unverified.length === 0 && <p className="adminSub">Nobody — everyone who has joined has confirmed.</p>}
      {unverified.map((u) => (
        <div className="attentionRow" key={u.id}>
          <span>
            <b>{u.slug ? <Link href={`/members/${u.slug}`} style={{ textDecoration: 'underline' }}>{u.display_name}</Link> : u.display_name}</b>
            <span style={{ color: 'var(--text-faint)', fontSize: 12 }}> {u.email}</span>
            <div style={{ color: 'var(--text-faint)', fontSize: 11.5 }}>
              {u.hours_waiting < 24
                ? `Joined ${u.hours_waiting}h ago`
                : `Joined ${Math.floor(u.hours_waiting / 24)} day${Math.floor(u.hours_waiting / 24) === 1 ? '' : 's'} ago`}
              {u.reminded_at
                ? ` · reminded ${new Date(u.reminded_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}`
                : u.hours_waiting >= VERIFY_NUDGE_AFTER_HOURS ? ' · reminder due' : ' · too soon to remind'}
            </div>
          </span>
          <VerificationControls memberId={u.id} name={u.display_name} />
        </div>
      ))}

      <div className="sectionLabel">Grant membership</div>
      <p className="adminSub">DJs, promoters, journalists, partners, early members, competition winners — ours to give. Optional expiry; lifetime never expires.</p>
      <GrantMembership />

      {flagged.length > 0 && (
        <>
          <div className="sectionLabel" style={{ marginTop: 30 }}>Worth a look</div>
          <p className="adminSub">Unusual patterns, for a person to judge. Nothing is restricted automatically.</p>
          {flagged.map((x) => (
            <div className="attentionRow" key={x.member_id}>
              <span><b>{x.display_name}</b> <span style={{ color: 'var(--text-faint)', fontSize: 12 }}>{x.email}</span></span>
              <span>{x.flags.map((f) => <span className="flagChip" key={f}>{f}</span>)}</span>
            </div>
          ))}
        </>
      )}

      <div className="sectionLabel" style={{ marginTop: 30 }}>Every membership ({ledger.length})</div>
      <div className="adminTableWrap">
        <table className="adminTable">
          <thead>
            <tr>
              <th>Member</th><th>Status</th><th>Source</th><th>Since</th><th>Ends</th>
              <th>Req · month</th><th>Req · all</th><th>Free</th><th>Disc.</th><th>Bought</th><th>Declined</th><th>+1s</th>
              <th>Cost · month</th><th>Cost · all</th><th>Paid</th><th></th>
            </tr>
          </thead>
          <tbody>
            {ledger.map((x) => (
              <tr key={x.member_id}>
                <td>{x.slug ? <Link href={`/members/${x.slug}`} style={{ textDecoration: 'underline' }}>{x.display_name}</Link> : x.display_name}<div style={{ color: 'var(--text-faint)', fontSize: 11.5 }}>{x.email}</div></td>
                <td><span className={`evChip ${x.active ? 'green' : x.membership.status === 'past_due' ? 'amber' : ''}`}>{x.label}</span></td>
                <td>{x.membership.billing_source}{x.membership.grant_note && <div style={{ color: 'var(--text-faint)', fontSize: 11.5 }}>{x.membership.grant_note}</div>}</td>
                <td>{x.membership.member_since ? new Date(x.membership.member_since).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' }) : '—'}</td>
                <td>{x.membership.current_period_end ? new Date(x.membership.current_period_end).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: '2-digit' }) : x.membership.billing_source === 'lifetime' ? 'never' : '—'}</td>
                <td>{x.requests_month}</td><td>{x.requests_lifetime}</td><td>{x.free_entries}</td><td>{x.discounts}</td><td>{x.purchased}</td><td>{x.declined}</td><td>{x.plus_ones}</td>
                <td>{formatPence(x.cost_month_pence)}</td><td>{formatPence(x.cost_lifetime_pence)}</td><td>{formatPence(x.paid_pence)}</td>
                <td>{x.membership.billing_source !== 'stripe' && x.active && <RevokeMembership memberId={x.member_id} />}</td>
              </tr>
            ))}
            {ledger.length === 0 && <tr><td colSpan={16} className="adminSub">No memberships yet.</td></tr>}
          </tbody>
        </table>
      </div>

      <div className="sectionLabel" style={{ marginTop: 30 }}>Waitlist ({waitlist.length})</div>
      {waitlist.length === 0 && <p className="adminSub">Nobody yet.</p>}
      {waitlist.slice(0, 100).map((w) => (
        <div className="attentionRow" key={w.email}>
          <span>{w.email}{w.display_name && <span style={{ color: 'var(--text-faint)', fontSize: 12 }}> · {w.display_name}</span>}</span>
          <span style={{ color: 'var(--text-faint)', fontSize: 12 }}>{new Date(w.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</span>
        </div>
      ))}
    </main>
  );
}
