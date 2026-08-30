'use client';

// Archive Desk actions + bulk import panel.

import { useState } from 'react';
import { useRouter } from 'next/navigation';

function useArchiveAction() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function run(body: Record<string, unknown>): Promise<Record<string, unknown> | null> {
    setBusy(true);
    setError(null);
    const res = await fetch('/api/admin/archive', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) { setError(data.error ?? 'Failed'); return null; }
    router.refresh();
    return data;
  }
  return { run, busy, error };
}

export function ArchiveEventActions({ eventId, duplicateOf }: { eventId: string; duplicateOf: string | null }) {
  const { run, busy, error } = useArchiveAction();
  return (
    <span style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
      <button className="btnGhost" type="button" disabled={busy}
              onClick={() => run({ action: 'publish_event', eventId })}>Publish</button>
      <button className="btnGhost" type="button" disabled={busy}
              onClick={() => run({ action: 'needs_research', eventId })}>Needs research</button>
      <button className="btnGhost" type="button" disabled={busy}
              onClick={() => run({ action: 'reject_event', eventId })}>Reject</button>
      {duplicateOf && (
        <button className="btnGhost" type="button" disabled={busy}
                onClick={() => run({ action: 'merge_events', keepId: duplicateOf, dupId: eventId })}>
          Merge into match
        </button>
      )}
      {error && <span className="formError">{error}</span>}
    </span>
  );
}

export function ArchiveItemActions({ itemId }: { itemId: string }) {
  const { run, busy, error } = useArchiveAction();
  return (
    <span style={{ display: 'flex', gap: 8 }}>
      <button className="btnGhost" type="button" disabled={busy}
              onClick={() => run({ action: 'publish_item', itemId })}>Publish item</button>
      <button className="btnGhost" type="button" disabled={busy}
              onClick={() => run({ action: 'reject_item', itemId })}>Reject</button>
      {error && <span className="formError">{error}</span>}
    </span>
  );
}

export function MixActions({ mixId }: { mixId: string }) {
  const { run, busy, error } = useArchiveAction();
  return (
    <span style={{ display: 'flex', gap: 8 }}>
      <button className="btnGhost" type="button" disabled={busy}
              onClick={() => run({ action: 'publish_mix', mixId })}>Publish mix</button>
      <button className="btnGhost" type="button" disabled={busy}
              onClick={() => run({ action: 'reject_mix', mixId })}>Reject</button>
      {error && <span className="formError">{error}</span>}
    </span>
  );
}

export function MediaRightsControl({ mediaId, rights, hidden }: { mediaId: string; rights: string; hidden: boolean }) {
  const { run, busy } = useArchiveAction();
  return (
    <span style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
      <select defaultValue={rights} disabled={busy}
              onChange={(e) => run({ action: 'set_media_rights', mediaId, rights: e.target.value })}
              style={{ background: 'var(--bg)', border: '1px solid var(--border-strong)', borderRadius: 8,
                       color: 'var(--text)', padding: '5px 8px', fontSize: 12 }}>
        {['unknown', 'guestlist_owned', 'contributor_granted', 'licensed', 'external_reference', 'restricted']
          .map((r) => <option key={r} value={r}>{r.replace(/_/g, ' ')}</option>)}
      </select>
      <button className="recHide" type="button" disabled={busy}
              onClick={() => run({ action: hidden ? 'show_media' : 'hide_media', mediaId })}>
        {hidden ? 'unhide' : 'hide image'}
      </button>
    </span>
  );
}

export function CorrectionActions({ correctionId }: { correctionId: string }) {
  const { run, busy } = useArchiveAction();
  return (
    <span style={{ display: 'flex', gap: 8 }}>
      <button className="btnGhost" type="button" disabled={busy}
              onClick={() => run({ action: 'resolve_correction', correctionId, applied: true })}>Applied</button>
      <button className="btnGhost" type="button" disabled={busy}
              onClick={() => run({ action: 'resolve_correction', correctionId, applied: false })}>Reject</button>
    </span>
  );
}

export function MemoryModAction({ memoryId }: { memoryId: string }) {
  const { run, busy } = useArchiveAction();
  return (
    <button className="btnGhost" type="button" disabled={busy}
            onClick={() => run({ action: 'remove_memory', memoryId })}>Remove memory</button>
  );
}

export function BulkImportPanel() {
  const { run, busy, error } = useArchiveAction();
  const [format, setFormat] = useState<'json' | 'csv'>('csv');
  const [text, setText] = useState('');
  const [report, setReport] = useState<Record<string, unknown> | null>(null);

  async function go(dryRun: boolean) {
    const data = await run({ action: 'bulk_import', format, text, dryRun, sourceRef: `desk-${format}` });
    if (data?.report) setReport(data.report as Record<string, unknown>);
  }

  const r = report as {
    dryRun?: boolean; found?: number; valid?: number; imported?: number;
    invalid?: { row: number; problems: string[] }[];
    duplicates?: { row: number; title: string; bucket: string; matchTitle: string | null }[];
    newEntities?: string[]; uncertainDates?: number;
  } | null;

  return (
    <div className="adminRow" style={{ display: 'grid', gap: 10 }}>
      <div className="sectionLabel" style={{ margin: 0 }}>Bulk import (dry run first, always)</div>
      <div style={{ display: 'flex', gap: 8 }}>
        <select value={format} onChange={(e) => setFormat(e.target.value as 'json' | 'csv')}
                style={{ background: 'var(--bg)', border: '1px solid var(--border-strong)', borderRadius: 8,
                         color: 'var(--text)', padding: '7px 10px' }}>
          <option value="csv">CSV (header: title,date,venue,promoter,city,country,lineup,genres,…)</option>
          <option value="json">JSON array</option>
        </select>
      </div>
      <textarea rows={6} value={text} onChange={(e) => setText(e.target.value)}
                placeholder={'title,date,venue,city,country,lineup,genres\n"Metalheadz","1996","Blue Note","London","United Kingdom","Goldie; Doc Scott","Jungle; Drum & Bass"'}
                style={{ background: 'var(--bg)', border: '1px solid var(--border-strong)', borderRadius: 8,
                         color: 'var(--text)', padding: 10, fontFamily: 'monospace', fontSize: 12 }} />
      <div style={{ display: 'flex', gap: 8 }}>
        <button className="btnGhost" type="button" disabled={busy || !text.trim()} onClick={() => go(true)}>
          Dry run
        </button>
        <button className="btnAccent" type="button"
                disabled={busy || !text.trim() || !r || r.dryRun === false}
                onClick={() => go(false)}
                title="Run a dry run first">
          Import for review
        </button>
      </div>
      {error && <div className="formError">{error}</div>}
      {r && (
        <div className="youHistoryMeta" style={{ lineHeight: 1.8 }}>
          <strong>{r.dryRun ? 'DRY RUN' : 'IMPORTED'}</strong> — found {r.found} · valid {r.valid} ·
          invalid {r.invalid?.length ?? 0} · duplicates held {r.duplicates?.length ?? 0} ·
          uncertain dates {r.uncertainDates} · new places {r.newEntities?.length ?? 0}
          {!r.dryRun && <> · <strong>{r.imported} imported for review</strong></>}
          {(r.invalid?.length ?? 0) > 0 && (
            <div>Problems: {r.invalid!.slice(0, 5).map((x) => `row ${x.row}: ${x.problems.join(', ')}`).join(' · ')}</div>
          )}
          {(r.duplicates?.length ?? 0) > 0 && (
            <div>Duplicates: {r.duplicates!.slice(0, 5).map((d) => `“${d.title}” ${d.bucket}${d.matchTitle ? ` → ${d.matchTitle}` : ''}`).join(' · ')}</div>
          )}
          {(r.newEntities?.length ?? 0) > 0 && <div>New places: {r.newEntities!.slice(0, 6).join(' · ')}</div>}
        </div>
      )}
    </div>
  );
}
