import Link from 'next/link';
import { dashContext } from '@/lib/promoterDash';
import { DashShell } from '@/components/promoter/DashShell';
import { query } from '@/lib/db';

export const dynamic = 'force-dynamic';

export default async function PromoterGuestlistsPage({ searchParams }: { searchParams: Promise<{ p?: string }> }) {
  const sp = await searchParams;
  const ctx = await dashContext(sp.p);
  if (ctx.kind !== 'ok' || ctx.active.claim_status !== 'verified') {
    return <DashShell ctx={ctx} tab="/guestlists">{null}</DashShell>;
  }
  const rows = await query<{
    id:string; title:string; start_at:string; timezone:string; mode:string|null;
    confirmed_people:number; pending_people:number; arrived_people:number;
  }>(`select e.id,e.title,e.start_at,e.timezone,s.mode,
      coalesce(sum(1+g.plus_ones) filter(where g.status='confirmed'),0)::int as confirmed_people,
      coalesce(sum(1+g.plus_ones) filter(where g.status='pending'),0)::int as pending_people,
      coalesce(sum(1+g.plus_ones) filter(where g.status='confirmed' and g.checked_in_at is not null),0)::int as arrived_people
    from events e
    left join event_guestlist_settings s on s.event_id=e.id
    left join event_guestlist_entries g on g.event_id=e.id and g.status in ('pending','confirmed')
    where e.promoter_id=$1 and e.start_at > now() - interval '1 day'
    group by e.id,s.mode
    order by e.start_at asc
    limit 80`,[ctx.active.id]);
  const q = ctx.promoterships.length > 1 ? `?p=${ctx.active.id}` : '';
  return <DashShell ctx={ctx} tab="/guestlists">
    <div className="sectionLabel">Guestlists</div>
    <p className="adminSub">Manage names, Guestlist.net allocation, door check-in and attendance for each event.</p>
    <div style={{display:'grid',gap:10,marginTop:18}}>{rows.length?rows.map(e=><Link key={e.id} href={`/promoter/guestlists/${e.id}${q}`} className="adminCard" style={{display:'grid',gridTemplateColumns:'minmax(220px,2fr) repeat(3,minmax(80px,auto)) auto',gap:14,alignItems:'center',textDecoration:'none'}}>
      <div><b>{e.title}</b><div className="adminSub">{new Date(e.start_at).toLocaleString()} · {(e.mode??'promoter_only').replaceAll('_',' ')}</div></div>
      <div><b>{e.confirmed_people}</b><div className="adminSub">confirmed</div></div>
      <div><b>{e.pending_people}</b><div className="adminSub">pending</div></div>
      <div><b>{e.arrived_people}</b><div className="adminSub">arrived</div></div>
      <span>Manage →</span>
    </Link>):<div className="emptyState">No upcoming events to manage.</div>}</div>
  </DashShell>;
}
