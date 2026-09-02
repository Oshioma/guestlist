// ADMIN → SYSTEM → SYSTEMS: one page that says whether every service this
// deployment leans on is set up and answering. Stripe, Resend, Anthropic,
// image search, storage, YouTube, X, the cron, the database — set / working
// / broken, with the fix next to anything that is not.

import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getCurrentMember } from '@/lib/auth';
import { envStatus, runSystemsCheck, type Verdict } from '@/lib/systemsCheck';

export const dynamic = 'force-dynamic';

const LABEL: Record<Verdict, string> = { ok: 'OK', warn: 'Check', bad: 'Broken', off: 'Off' };

export default async function SystemsPage() {
  // The admin layout already redirects non-admins, but the page renders in
  // parallel with it and this one reads live provider state — so it checks
  // for itself and never starts the checks for anyone else.
  const me = await getCurrentMember();
  if (!me || me.role !== 'admin') redirect('/events');
  const [report, envs] = await Promise.all([runSystemsCheck(), Promise.resolve(envStatus())]);
  const headline = report.bad > 0
    ? `${report.bad} thing${report.bad === 1 ? '' : 's'} broken${report.warn ? `, ${report.warn} to check` : ''}.`
    : report.warn > 0 ? `Nothing broken. ${report.warn} thing${report.warn === 1 ? '' : 's'} to check.`
    : 'All good — everything that is switched on is answering.';

  return (
    <main>
      <h1 className="adminTitle">Systems</h1>
      <p className="adminSub">
        Every service this deployment depends on, checked live: is the key set, does the provider accept it, is the last thing it did recent.
        Secrets are never shown here — only whether they are set.
      </p>

      <div className={`schemaVerdict ${report.bad > 0 ? 'bad' : 'ok'}`}>
        <strong>{headline}</strong>
        <div style={{ color: 'var(--text-muted)', fontSize: 13, marginTop: 4 }}>
          Checked {new Date(report.ranAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })} · <Link href="/admin/systems" style={{ textDecoration: 'underline' }}>run again</Link> · <Link href="/admin/schema" style={{ textDecoration: 'underline' }}>database detail</Link>
        </div>
      </div>

      <div className="sysGrid">
        {report.groups.map((g) => {
          const worst: Verdict = g.checks.some((c) => c.verdict === 'bad') ? 'bad' : g.checks.some((c) => c.verdict === 'warn') ? 'warn' : g.checks.every((c) => c.verdict === 'off') ? 'off' : 'ok';
          return (
            <section className={`sysGroup ${worst}`} key={g.key} aria-label={g.name}>
              <header>
                <h2>{g.name}</h2>
                <span className={`sysPill ${worst}`}>{LABEL[worst]}</span>
              </header>
              <p className="adminSub">{g.blurb}</p>
              <ul className="sysList">
                {g.checks.map((c) => (
                  <li key={c.name} className={`sysRow ${c.verdict}`}>
                    <span className={`sysDot ${c.verdict}`} aria-label={LABEL[c.verdict]} />
                    <div>
                      <div className="sysName">{c.name}</div>
                      <div className="sysDetail">{c.detail}</div>
                      {c.hint && <div className="sysHint">{c.hint}</div>}
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>

      <div className="sectionLabel" style={{ marginTop: 34 }}>Environment variables</div>
      <p className="adminSub">Everything the code reads. Set in Vercel → Project → Settings → Environment Variables, then redeploy.</p>
      <div className="sysEnv">
        {envs.map((g) => (
          <div key={g.group}>
            <h3>{g.group}</h3>
            {g.vars.map((v) => (
              <div className="sysEnvRow" key={v.name}>
                <code>{v.name}</code>
                <span className="sysEnvWhy">{v.why}</span>
                <span className={`sysEnvState ${v.state}`}>{v.state === 'set' ? 'set' : v.state === 'missing' ? 'MISSING' : v.state === 'danger' ? 'REMOVE' : 'not set'}</span>
              </div>
            ))}
          </div>
        ))}
      </div>
    </main>
  );
}
