// The shape of a fetch probe and the plain-English verdict an admin reads.
// Pure — no server imports — so both the admin table and the discovery
// workbench can render the same sentence for the same result.

export type FetchProbe = {
  ok: boolean;
  status: number | null;
  code: string | null;
  detail: string | null;
  ms: number;
};

export type ProbeResult = {
  target: string;
  bot: FetchProbe;
  browser: FetchProbe;
  method: 'rss' | 'html' | null;
  candidates: number | null;
};

export const probeLabel = (p: FetchProbe) =>
  p.ok ? `HTTP ${p.status}` : `${p.code}${p.detail ? ` (${p.detail})` : ''}`;

// Turn the two probes into the sentence an admin actually needs.
export function testVerdict(t: ProbeResult): { text: string; bad: boolean } {
  if (t.bot.ok && (t.candidates ?? 0) > 0) {
    return {
      text: `OK — ${t.candidates} candidate event link${t.candidates === 1 ? '' : 's'} via ${t.method?.toUpperCase()}`,
      bad: false,
    };
  }
  if (t.bot.ok) {
    // Naming the method matters: a zero-candidate RSS result means the saved
    // feed is the problem, not the listing page's markup.
    return {
      text:
        t.method === 'rss'
          ? 'Reachable, but this feed contains no event links — it is probably a generic blog or news feed. Clear the feed URL below so scans use the listing page again.'
          : 'Reachable, but no event links found in the raw HTML — the page may render its listings with JavaScript, or its link paths are unrecognised',
      bad: true,
    };
  }
  if (t.browser.ok) {
    return {
      text: `The site filters by user agent: GuestlistBot got ${probeLabel(t.bot)} while a browser user agent got ${probeLabel(t.browser)}`,
      bad: true,
    };
  }
  return {
    text: `Unreachable with both user agents (bot: ${probeLabel(t.bot)}, browser: ${probeLabel(t.browser)}) — wrong URL, or the site blocks this server's IP`,
    bad: true,
  };
}
