// ADMIN → DROPS: member drops and the community projects the membership
// supports. Both written by people; nothing invented.

import { allDrops, allGoodCauses } from '@/lib/drops';
import { query } from '@/lib/db';
import { CauseEditor, DropEditor, EMPTY_CAUSE, EMPTY_DROP, Editable } from '@/components/admin/DropsDesk';

export const dynamic = 'force-dynamic';

export default async function AdminDropsPage() {
  const [drops, causes, claims] = await Promise.all([
    allDrops(), allGoodCauses(),
    query<{ id: string; drop_id: string; display_name: string; email: string; status: string; created_at: string }>(
      `select k.id, k.drop_id, m.display_name, m.email, k.status, k.created_at::text
         from member_drop_claims k join members m on m.id = k.member_id order by k.created_at desc limit 200`),
  ]);

  return (
    <main>
      <h1 className="adminTitle">Member drops</h1>
      <p className="adminSub">Surprise tickets, last-minute lists, secret parties. Live drops appear to active members in their membership area.</p>
      <Editable label="+ New drop" initial={EMPTY_DROP} Editor={DropEditor} />
      <div style={{ marginTop: 16 }}>
        {drops.map((d) => {
          const names = claims.filter((c) => c.drop_id === d.id);
          return (
            <div className="attentionRow" key={d.id} style={{ flexWrap: 'wrap' }}>
              <span>
                <b>{d.title}</b> <span className={`evChip ${d.status === 'live' ? 'green' : d.status === 'draft' ? 'amber' : ''}`}>{d.status}</span>
                <div style={{ color: 'var(--text-faint)', fontSize: 12 }}>
                  {d.event_title && `${d.event_title} · `}{d.claims} down{d.places != null && ` of ${d.places}`}
                  {d.ends_at && ` · until ${new Date(d.ends_at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}`}
                </div>
                {names.length > 0 && <div style={{ fontSize: 12, marginTop: 4 }}>{names.map((n) => `${n.display_name} (${n.status})`).join(' · ')}</div>}
              </span>
              <Editable label="Edit" Editor={DropEditor} initial={{
                id: d.id, title: d.title, body: d.body ?? '', eventId: d.event_id ?? '', linkUrl: d.link_url ?? '',
                places: d.places?.toString() ?? '', startsAt: d.starts_at, endsAt: d.ends_at ?? '', status: d.status,
              }} />
            </div>
          );
        })}
        {drops.length === 0 && <p className="adminSub">No drops yet.</p>}
      </div>

      <h2 className="adminTitle" style={{ marginTop: 40 }}>Do good for others</h2>
      <p className="adminSub">The community projects the membership supports. Ships empty on purpose: the membership page says nothing about donations until a real project is written here.</p>
      <Editable label="+ New project" initial={EMPTY_CAUSE} Editor={CauseEditor} />
      <div style={{ marginTop: 16 }}>
        {causes.map((c) => (
          <div className="attentionRow" key={c.id} style={{ flexWrap: 'wrap' }}>
            <span><b>{c.title}</b> <span className={`evChip ${c.status === 'live' ? 'green' : c.status === 'draft' ? 'amber' : ''}`}>{c.status}</span>{c.summary && <div style={{ color: 'var(--text-faint)', fontSize: 12 }}>{c.summary}</div>}</span>
            <Editable label="Edit" Editor={CauseEditor} initial={{
              id: c.id, title: c.title, summary: c.summary ?? '', body: c.body ?? '', imageUrl: c.image_url ?? '',
              linkUrl: c.link_url ?? '', status: c.status, sortOrder: String(c.sort_order),
            }} />
          </div>
        ))}
        {causes.length === 0 && <p className="adminSub">No projects defined yet.</p>}
      </div>
    </main>
  );
}
