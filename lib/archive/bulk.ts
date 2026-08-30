// Bulk archive ingestion: CSV or JSON in → parse → DRY RUN report →
// deliberate import. Never a blind dump into live tables: every run is an
// archive_ingestions row, imports land as 'needs_review' for the Archive
// Desk unless the admin explicitly publishes.

import { query, queryOne } from '../db';
import {
  assessArchiveDuplicate, createArchiveEvent, type ArchiveEventInput,
} from './core';
import { normalizeSceneName } from '../scene';

export type BulkRow = {
  title?: string;
  date?: string;          // YYYY-MM-DD | YYYY-MM | YYYY
  display_date?: string;  // for circa ("Summer 1996")
  venue?: string;
  promoter?: string;
  city?: string;
  country?: string;
  lineup?: string;        // "Goldie; Doc Scott" or array in JSON
  genres?: string;        // "Jungle; Drum & Bass" or array
  description?: string;
  price?: string;
  source_url?: string;
  source?: string;        // attribution
  language?: string;
};

export function parseBulk(text: string, format: 'json' | 'csv'): { rows: BulkRow[]; error?: string } {
  try {
    if (format === 'json') {
      const data = JSON.parse(text);
      if (!Array.isArray(data)) return { rows: [], error: 'JSON must be an array of items' };
      return { rows: data.slice(0, 2000) };
    }
    // Simple CSV: header row, comma separated, double-quote escaping.
    const lines = text.split(/\r?\n/).filter((l) => l.trim());
    if (lines.length < 2) return { rows: [], error: 'CSV needs a header row and at least one item' };
    const parseLine = (line: string): string[] => {
      const out: string[] = [];
      let cur = '';
      let inQ = false;
      for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (inQ) {
          if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
          else if (ch === '"') inQ = false;
          else cur += ch;
        } else if (ch === '"') inQ = true;
        else if (ch === ',') { out.push(cur); cur = ''; }
        else cur += ch;
      }
      out.push(cur);
      return out;
    };
    const headers = parseLine(lines[0]).map((h) => h.trim().toLowerCase().replace(/\s+/g, '_'));
    const rows = lines.slice(1, 2001).map((line) => {
      const cells = parseLine(line);
      const row: Record<string, string> = {};
      headers.forEach((h, i) => { if (cells[i]?.trim()) row[h] = cells[i].trim(); });
      return row as BulkRow;
    });
    return { rows };
  } catch (err) {
    return { rows: [], error: `Parse failed: ${String(err).slice(0, 200)}` };
  }
}

function toList(v: unknown): string[] {
  if (Array.isArray(v)) return v.map(String).map((s) => s.trim()).filter(Boolean);
  if (typeof v === 'string') return v.split(/[;|]/).map((s) => s.trim()).filter(Boolean);
  return [];
}

export function rowToInput(row: BulkRow): { input: ArchiveEventInput; problems: string[] } {
  const problems: string[] = [];
  const title = row.title?.trim() ?? '';
  if (!title) problems.push('missing title');

  let date: ArchiveEventInput['date'] = { precision: 'unknown' };
  const d = row.date?.trim();
  if (d && /^\d{4}-\d{2}-\d{2}$/.test(d)) date = { precision: 'exact', startDate: d };
  else if (d && /^\d{4}-\d{2}$/.test(d)) date = { precision: 'month', startDate: `${d}-01` };
  else if (d && /^\d{4}$/.test(d)) {
    date = row.display_date
      ? { precision: 'circa', year: Number(d), displayDate: row.display_date }
      : { precision: 'year', year: Number(d) };
  } else if (d) problems.push(`unparseable date "${d}" (use YYYY, YYYY-MM or YYYY-MM-DD)`);

  return {
    input: {
      title: title || 'Untitled',
      description: row.description ?? null,
      originalLanguage: row.language?.slice(0, 2)?.toLowerCase() ?? null,
      date,
      venueName: row.venue ?? null,
      promoterName: row.promoter ?? null,
      city: row.city ?? null,
      country: row.country ?? null,
      priceNote: row.price ?? null,
      sourceUrl: row.source_url ?? null,
      sourceAttribution: row.source ?? null,
      lineup: toList(row.lineup),
      genreNames: toList(row.genres),
      provenance: { import: 'EXTERNAL_SOURCE' },
      status: 'needs_review',
    },
    problems,
  };
}

export type BulkReport = {
  ingestionId: string;
  dryRun: boolean;
  found: number;
  valid: number;
  invalid: { row: number; problems: string[] }[];
  duplicates: { row: number; title: string; bucket: string; matchTitle: string | null }[];
  uncertainDates: number;
  newEntities: string[];
  imported: number;
};

export async function runBulkImport(
  text: string,
  format: 'json' | 'csv',
  opts: { dryRun: boolean; sourceRef: string; adminId: string }
): Promise<BulkReport | { error: string }> {
  const parsed = parseBulk(text, format);
  if (parsed.error) return { error: parsed.error };

  const ingestion = await queryOne<{ id: string }>(
    `insert into archive_ingestions (kind, source_ref, dry_run, created_by)
     values ($1, $2, $3, $4) returning id`,
    [format === 'json' ? 'bulk_json' : 'bulk_csv', opts.sourceRef.slice(0, 200), opts.dryRun, opts.adminId]
  );

  const report: BulkReport = {
    ingestionId: ingestion!.id, dryRun: opts.dryRun,
    found: parsed.rows.length, valid: 0, invalid: [], duplicates: [],
    uncertainDates: 0, newEntities: [], imported: 0,
  };
  const seenVenues = new Set<string>();

  for (const [i, row] of parsed.rows.entries()) {
    const { input, problems } = rowToInput(row);
    if (problems.length) {
      report.invalid.push({ row: i + 1, problems });
      continue;
    }
    report.valid++;
    if (input.date.precision !== 'exact') report.uncertainDates++;

    const dup = await assessArchiveDuplicate({
      title: input.title,
      year: input.date.year ?? (input.date.startDate ? Number(input.date.startDate.slice(0, 4)) : null),
      startDate: input.date.precision === 'exact' ? input.date.startDate : null,
      venueName: input.venueName,
      city: input.city,
      lineup: input.lineup,
      sourceUrl: input.sourceUrl,
    });
    if (dup.bucket !== 'none') {
      report.duplicates.push({ row: i + 1, title: input.title, bucket: dup.bucket, matchTitle: dup.matchTitle });
      if (dup.bucket === 'exact' || dup.bucket === 'likely') continue; // held either way
    }
    if (input.venueName) {
      const norm = normalizeSceneName(input.venueName);
      const exists = await queryOne(
        `select 1 from scene_entities where normalized_name = $1`, [norm]);
      const key = `${input.venueName} (${input.city ?? '?'})`;
      if (!exists && !seenVenues.has(key)) {
        seenVenues.add(key);
        report.newEntities.push(key);
      }
    }
    if (!opts.dryRun) {
      const created = await createArchiveEvent(input, opts.adminId);
      if (!('error' in created)) report.imported++;
    }
  }
  await query(
    `update archive_ingestions set status = 'completed', completed_at = now(), stats = $2 where id = $1`,
    [ingestion!.id, JSON.stringify({
      found: report.found, valid: report.valid, invalid: report.invalid.length,
      duplicates: report.duplicates.length, uncertain_dates: report.uncertainDates,
      new_entities: report.newEntities.length, imported: report.imported,
    })]
  );
  return report;
}
