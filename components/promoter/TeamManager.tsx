'use client';

// Team list, invites, role management. OWNER: everything. ADMIN: everything
// below ownership. EDITOR: events. ANALYST: analytics only.

import { useState } from 'react';
import { useRouter } from 'next/navigation';

type TeamRow = { member_id: string; display_name: string; email: string; avatar_url: string | null; role: string };
type Invite = { id: string; email: string; role: string; expires_at: string };

const ROLE_HELP = [
  ['Owner', 'everything, including ownership'],
  ['Admin', 'events, sources, profile and team (not ownership)'],
  ['Editor', 'event editing'],
  ['Analyst', 'analytics only'],
];

export function TeamManager({
  promoterId,
  selfId,
  selfRole,
  canManage,
  isOwner,
  team,
  pendingInvites,
}: {
  promoterId: string;
  selfId: string;
  selfRole: string;
  canManage: boolean;
  isOwner: boolean;
  team: TeamRow[];
  pendingInvites: Invite[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [inviteUrl, setInviteUrl] = useState('');
  const [inviteNote, setInviteNote] = useState('');

  async function invite(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    setError('');
    setInviteUrl('');
    const res = await fetch(`/api/promoter/${promoterId}/team`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: f.get('email'), role: f.get('role') }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (res.ok) {
      setInviteUrl(window.location.origin + data.inviteUrl);
      setInviteNote(data.note ?? '');
      router.refresh();
    } else {
      setError(data.error ?? 'Invite failed');
    }
  }

  async function updateMember(memberId: string, patch: { role?: string; remove?: boolean }) {
    if (patch.remove && !confirm('Remove this team member?')) return;
    setBusy(true);
    setError('');
    const res = await fetch(`/api/promoter/${promoterId}/team`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ memberId, ...patch }),
    });
    setBusy(false);
    if (res.ok) router.refresh();
    else setError((await res.json().catch(() => ({})))?.error ?? 'Failed');
  }

  return (
    <div style={{ maxWidth: 640 }}>
      <div className="sectionLabel">Team</div>
      {team.map((m) => (
        <div className="memberRow" key={m.member_id}>
          {m.avatar_url && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={m.avatar_url} alt="" />
          )}
          <div style={{ flex: 1 }}>
            <div className="name">{m.display_name}{m.member_id === selfId && ' (you)'}</div>
            <div className="loc">{m.email}</div>
          </div>
          {canManage && m.member_id !== selfId ? (
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <select
                value={m.role}
                disabled={busy || (m.role === 'owner' && !isOwner)}
                onChange={(e) => updateMember(m.member_id, { role: e.target.value })}
                style={{
                  background: 'var(--surface)', border: '1px solid var(--border)',
                  color: 'var(--text-soft)', borderRadius: 999, padding: '5px 10px', fontSize: 12,
                }}
              >
                {['owner', 'admin', 'editor', 'analyst'].map((r) => (
                  <option key={r} value={r} disabled={r === 'owner' && !isOwner}>{r}</option>
                ))}
              </select>
              <button className="btnGhost" style={{ padding: '5px 10px', fontSize: 11 }}
                      disabled={busy || (m.role === 'owner' && !isOwner)}
                      onClick={() => updateMember(m.member_id, { remove: true })} type="button">
                Remove
              </button>
            </div>
          ) : (
            <span className="confidencePill">{m.role}</span>
          )}
        </div>
      ))}

      {pendingInvites.length > 0 && (
        <>
          <div className="sectionLabel" style={{ marginTop: 22 }}>Pending invites</div>
          {pendingInvites.map((i) => (
            <div className="attentionRow" key={i.id}>
              <span>{i.email}</span>
              <span className="confidencePill">{i.role}</span>
            </div>
          ))}
        </>
      )}

      {canManage && (
        <>
          <div className="sectionLabel" style={{ marginTop: 22 }}>Invite someone</div>
          <form onSubmit={invite} style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <input name="email" type="email" required placeholder="email@…"
                   style={{
                     flex: 1, minWidth: 200, background: 'var(--surface)', border: '1px solid var(--border)',
                     borderRadius: 999, color: 'var(--text)', padding: '10px 16px', fontSize: 13.5, outline: 'none',
                   }} />
            <select name="role" defaultValue="editor"
                    style={{
                      background: 'var(--surface)', border: '1px solid var(--border)',
                      color: 'var(--text-soft)', borderRadius: 999, padding: '10px 14px', fontSize: 13,
                    }}>
              {(selfRole === 'owner' || selfRole === 'admin') && <option value="admin">admin</option>}
              <option value="editor">editor</option>
              <option value="analyst">analyst</option>
            </select>
            <button className="btnAccent" disabled={busy} type="submit">{busy ? '…' : 'Invite'}</button>
          </form>
          {inviteUrl && (
            <div className="joinPrompt" style={{ marginTop: 12, textAlign: 'left', wordBreak: 'break-all' }}>
              {inviteNote}
              <div style={{ marginTop: 8, fontFamily: 'monospace', fontSize: 12.5 }}>{inviteUrl}</div>
            </div>
          )}
          <div className="muted" style={{ marginTop: 18, fontSize: 12.5, lineHeight: 1.7, color: 'var(--text-faint)' }}>
            {ROLE_HELP.map(([r, h]) => <div key={r}><b>{r}</b>: {h}</div>)}
          </div>
        </>
      )}
      {error && <div className="formError">{error}</div>}
    </div>
  );
}
