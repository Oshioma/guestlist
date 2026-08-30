// Honest historical dates. Uncertainty is a first-class value — "Summer
// 1996" must never silently become 1 June 1996.
//
//   exact  → start_date is the real day
//   month  → year+month known; start_date anchors to day 1 for sorting but
//            the day is NEVER displayed
//   year   → year only
//   circa  → display_date carries the human truth ("Summer 1996", "circa 1994")
//   unknown→ no date claim at all

export type DatePrecision = 'exact' | 'month' | 'year' | 'circa' | 'unknown';

export type ArchiveDateInput = {
  precision: DatePrecision;
  startDate?: string | null; // YYYY-MM-DD (exact/month)
  endDate?: string | null;
  year?: number | null;      // year/circa
  displayDate?: string | null; // required for circa
};

export type ArchiveDate = {
  precision: DatePrecision;
  start_date: string | null;
  end_date: string | null;
  year: number | null;
  display_date: string;
};

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
  'August', 'September', 'October', 'November', 'December'];

export function resolveArchiveDate(input: ArchiveDateInput): ArchiveDate | { error: string } {
  const p = input.precision;
  const iso = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);

  if (p === 'exact') {
    if (!iso(input.startDate)) return { error: 'Exact precision needs a full date' };
    const d = new Date(`${input.startDate}T00:00:00Z`);
    if (Number.isNaN(d.getTime())) return { error: 'Invalid date' };
    const end = iso(input.endDate) ? input.endDate : null;
    return {
      precision: 'exact',
      start_date: input.startDate,
      end_date: end,
      year: d.getUTCFullYear(),
      display_date: formatExact(input.startDate, end),
    };
  }
  if (p === 'month') {
    if (!iso(input.startDate)) return { error: 'Month precision needs a year-month date' };
    const [y, m] = input.startDate.split('-').map(Number);
    if (m < 1 || m > 12) return { error: 'Invalid month' };
    return {
      precision: 'month',
      start_date: `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-01`, // anchor only
      end_date: null,
      year: y,
      display_date: `${MONTHS[m - 1]} ${y}`,
    };
  }
  if (p === 'year' || p === 'circa') {
    const year = Number(input.year);
    if (!Number.isInteger(year) || year < 1950 || year > 2100) {
      return { error: `${p} precision needs a plausible year` };
    }
    if (p === 'circa') {
      const display = input.displayDate?.trim();
      if (!display) return { error: 'Circa dates need their human wording ("Summer 1996")' };
      return { precision: 'circa', start_date: null, end_date: null, year, display_date: display.slice(0, 60) };
    }
    return { precision: 'year', start_date: null, end_date: null, year, display_date: String(year) };
  }
  return { precision: 'unknown', start_date: null, end_date: null, year: null, display_date: 'Date unknown' };
}

function formatExact(start: string, end: string | null): string {
  const fmt = (s: string) => {
    const [y, m, d] = s.split('-').map(Number);
    return `${d} ${MONTHS[m - 1].slice(0, 3)} ${y}`;
  };
  return end && end !== start ? `${fmt(start)} – ${fmt(end)}` : fmt(start);
}

export function decadeOf(year: number | null): string | null {
  if (year == null) return null;
  return `${Math.floor(year / 10) * 10}s`;
}
