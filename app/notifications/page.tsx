// NOTIFICATIONS — one centre for everything: event alerts (multi-reason),
// reminders, connections going, travel/city digests, promoter review
// nudges, and Club Messenger social notifications. Structured rows are
// rendered here, not pre-baked strings.

import { redirect } from 'next/navigation';
import { getCurrentMember } from '@/lib/auth';
import { query } from '@/lib/db';
import { alertReasonText, type AlertReason } from '@/lib/alerts';
import { NotificationList, type NotificationRow } from '@/components/v2d/NotificationList';
import { reviewQueueSummary, type ReviewQueue } from '@/lib/adminNotify';

export const dynamic = 'force-dynamic';

export default async function NotificationsPage() {
  const member = await getCurrentMember();
  if (!member) redirect('/login?next=/notifications');

  const rows = await query<{
    id: string; type: string; created_at: string; read_at: string | null;
    payload: Record<string, unknown>;
    event_id: string | null; event_title: string | null; event_slug: string | null;
    actor_name: string | null; promoter_id: string | null;
  }>(
    `select n.id, n.type, n.created_at::text, n.read_at::text, n.payload,
            n.event_id, e.title as event_title, e.slug as event_slug,
            a.display_name as actor_name, n.promoter_id
       from notifications n
       left join events e on e.id = n.event_id
       left join members a on a.id = n.actor_member_id
      where n.member_id = $1
      order by n.created_at desc
      limit 60`,
    [member.id]
  );

  const items: NotificationRow[] = rows.map((n) => {
    let text = '';
    let href = '/events';
    const p = n.payload ?? {};
    switch (n.type) {
      case 'event_alert': {
        const reasons = (Array.isArray(p.reasons) ? (p.reasons as AlertReason[]) : []).slice(0, 3);
        text = `${n.event_title ?? p.title ?? 'New event'} — ${reasons.map(alertReasonText).join(' · ') || 'picked for you'}`;
        href = `/events/${n.event_slug ?? p.slug}?src=notif`;
        break;
      }
      case 'event_reminder':
        text = `Tomorrow: ${n.event_title ?? p.title}`;
        href = `/events/${n.event_slug ?? p.slug}?src=notif`;
        break;
      case 'connection_going':
        text = `${n.actor_name ?? p.actor_name ?? 'A connection'} is going to ${n.event_title ?? p.title}`;
        href = `/events/${n.event_slug ?? p.slug}?src=notif`;
        break;
      case 'close_friend_going':
        text = `★ ${n.actor_name ?? p.actor_name ?? 'A close friend'} is going to ${n.event_title ?? p.title}`;
        href = `/events/${n.event_slug ?? p.slug}?src=notif`;
        break;
      case 'promoter_announcement':
        text = String(p.message ?? `${p.promoter_name ?? 'A promoter you follow'}: ${n.event_title ?? p.title}`);
        href = `/events/${n.event_slug ?? p.slug}?src=${p.src ?? 'notif'}`;
        break;
      case 'archive_activity':
        text = String((p as { message?: string }).message ?? 'New material in the archive');
        href = '/archive';
        break;
      case 'travel_digest':
        text = `We found ${p.count} events for your ${p.city} trip`;
        href = `/${String(p.city ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
        break;
      case 'city_digest':
        text = `New in ${p.city}`;
        href = `/${String(p.city ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
        break;
      case 'promoter_review':
        text = `${p.waiting} event${Number(p.waiting) === 1 ? '' : 's'} waiting for review on your promoter page`;
        href = '/promoter/events';
        break;
      case 'friend_arrived':
        text = `${n.actor_name ?? 'A friend'} arrived${n.event_title ? ` at ${n.event_title}` : ''}`;
        href = n.event_id ? `/clubmessenger/events/${n.event_id}` : '/clubmessenger';
        break;
      case 'friend_pinged_you':
        text = `${n.actor_name ?? 'A friend'} asked where you are`;
        href = n.event_id ? `/clubmessenger/events/${n.event_id}` : '/clubmessenger';
        break;
      case 'event_room_message':
        text = `${n.actor_name ?? 'Someone'} messaged the room${n.event_title ? ` at ${n.event_title}` : ''}`;
        href = n.event_id ? `/clubmessenger/events/${n.event_id}` : '/clubmessenger';
        break;
      // Admin lines. These are about the site rather than about you, so they
      // say so and go straight to the desk that fixes them.
      case 'admin_new_member':
        text = `New member: ${n.actor_name ?? p.name ?? 'someone'}${p.city ? ` · ${p.city}` : ''}`;
        href = p.slug ? `/members/${p.slug}` : '/admin/network';
        break;
      case 'admin_new_article':
        text = `New article for review: “${p.title ?? 'Untitled'}” by ${p.author ?? 'a member'}`;
        href = '/admin/articles';
        break;
      case 'admin_review_waiting':
        text = reviewQueueSummary(p as unknown as ReviewQueue);
        href = '/admin/events';
        break;
      default:
        text = 'Notification';
    }
    return { id: n.id, text, href, created_at: n.created_at, read: !!n.read_at };
  });

  return (
    <main className="wrap" style={{ maxWidth: 720 }}>
      <h1 className="pageTitle">Notifications</h1>
      <NotificationList items={items} />
    </main>
  );
}
