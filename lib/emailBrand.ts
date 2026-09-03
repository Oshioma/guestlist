// WHAT A GUESTLIST EMAIL LOOKS LIKE — IN ONE PLACE.
//
// There were four of these, written separately, and they had drifted into a
// house style the website abandoned: a cream page, a black bar, and the word
// GUESTLIST typed out in letter-spaced caps with LIST in lilac. None of that
// is the brand. The brand is the purple wordmark on white, and somebody who
// clicks through from an email should not feel they have arrived somewhere
// else.
//
// So this is the shell, and everything that sends mail uses it. Changing what
// a Guestlist email looks like is now one edit rather than four, which is the
// only reason the drift happened in the first place.
//
// Written as tables with inline styles, because that is what mail clients
// render. Outlook has no flexbox, Gmail strips <style> blocks, and nothing
// here can afford to be clever.

const SITE = process.env.SITE_URL ?? 'https://www.guestlist.net';

/** The site's own palette, as literals — an email cannot read a CSS variable. */
export const BRAND = {
  page: '#f2f1ef',      // the ground the card sits on
  card: '#ffffff',      // the page itself
  ink: '#16150f',       // --text
  soft: '#67655c',      // --text-muted
  faint: '#93917f',     // --text-faint
  line: '#e7e6e2',      // --border, flattened (no alpha: mail clients vary)
  surface: '#f6f5f3',   // --surface, flattened
  accent: '#7c4a9e',    // --accent, the Guestlist purple
  accentInk: '#6d4090', // --accent-ink, purple as TEXT on white
  gold: '#9a7b1f',      // --gold-ink
  night: '#111014',     // for the one panel per email that is allowed to be dark
  onNight: '#f5f4f1',
  onNightSoft: '#a8a49c',
  onNightAccent: '#c9a2e8', // purple lightened to survive the dark panel
  // Single quotes inside, deliberately: this goes into style="…" attributes,
  // and a double quote in there ends the attribute and silently drops every
  // declaration after it — which is exactly how it broke the first time.
  font: "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif",
} as const;

export const esc = (v: string) =>
  v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * The wordmark, as the real artwork rather than typed-out letters.
 *
 * A remote image is blocked by default in plenty of inboxes, so the alt text
 * has to be the wordmark too — "GUESTLIST" in the right weight is what people
 * see until they press "show images", and that is a fine fallback.
 */
export function wordmark(): string {
  return `<a href="${SITE}" style="text-decoration:none;">`
    + `<img src="${SITE}/brand/Guestlist_purple_300dpi.png" width="176" height="18" alt="GUESTLIST"`
    + ` style="display:block;border:0;height:18px;width:176px;`
    + `font-family:${BRAND.font};font-size:15px;font-weight:800;letter-spacing:4px;color:${BRAND.accent};" /></a>`;
}

/** The one big button an email is allowed. */
export function button(url: string, label: string): string {
  return `<a href="${url}" style="display:inline-block;background:${BRAND.accent};color:#ffffff;`
    + `font-family:${BRAND.font};font-weight:800;font-size:14px;letter-spacing:0.6px;`
    + `text-decoration:none;border-radius:12px;padding:15px 34px;">${esc(label)}</a>`;
}

/**
 * The dark panel that carries the one sentence an email exists to deliver.
 * One per email. Two is a pattern, and a pattern is a page.
 */
export function heroPanel(kicker: string, headlineHtml: string, sub?: string): string {
  return `<div style="background:${BRAND.night};border-radius:16px;padding:32px 28px;">
    <div style="font-size:11px;font-weight:800;letter-spacing:3px;color:${BRAND.onNightAccent};text-transform:uppercase;">${esc(kicker)}</div>
    <div style="font-size:34px;line-height:1.06;font-weight:800;letter-spacing:-1.1px;color:${BRAND.onNight};margin-top:12px;">${headlineHtml}</div>
    ${sub ? `<div style="font-size:14px;color:${BRAND.onNightSoft};margin-top:16px;line-height:1.6;">${esc(sub)}</div>` : ''}
  </div>`;
}

export type ShellOptions = {
  /** The line inboxes show beside the subject. Never rendered. */
  preheader?: string;
  /** Everything between the wordmark and the footer rule, as table rows. */
  rows: string;
  /** Small print above the standing sign-off. Raw HTML: links belong here. */
  footerHtml?: string;
};

/**
 * A whole Guestlist email. The white card on a barely-there grey is the
 * website's own arrangement, so arriving on the site from here is continuous
 * rather than a change of scene.
 */
export function emailShell({ preheader, rows, footerHtml }: ShellOptions): string {
  return `<!doctype html><html><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<meta name="color-scheme" content="light only" />
<meta name="supported-color-schemes" content="light only" />
</head>
<body style="margin:0;padding:0;background:${BRAND.page};">
  ${preheader ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${esc(preheader)}</div>` : ''}
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${BRAND.page};">
    <tr><td align="center" style="padding:26px 14px 44px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
             style="max-width:560px;background:${BRAND.card};border:1px solid ${BRAND.line};border-radius:18px;font-family:${BRAND.font};color:${BRAND.ink};">

        <tr><td style="padding:24px 26px 4px;">${wordmark()}</td></tr>

        ${rows}

        <tr><td style="padding:22px 26px 26px;">
          <div style="border-top:1px solid ${BRAND.line};padding-top:16px;font-size:11.5px;color:${BRAND.faint};line-height:1.75;">
            ${footerHtml ? `${footerHtml}<br/>` : ''}
            Guestlist — the best events for our community, not every event.
          </div>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

/** A row of body copy at the shell's own gutter. */
export function row(html: string, padding = '18px 26px 0'): string {
  return `<tr><td style="padding:${padding};">${html}</td></tr>`;
}

/** A centred row, for the button. */
export function centreRow(html: string, padding = '24px 26px 4px'): string {
  return `<tr><td align="center" style="padding:${padding};">${html}</td></tr>`;
}
