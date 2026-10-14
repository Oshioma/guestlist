// What an article body is made of.
//
// The body stays plain text — paragraphs split by a blank line — so the AI
// coach, the typo fixer, revisions and the admin desk all keep working on a
// string. Two kinds of paragraph are pictures rather than words:
//
//   ![A caption, which is also the alt text](https://…/photo.jpg)
//   https://www.youtube.com/watch?v=dQw4w9WgXcQ
//
// An image line or a YouTube link standing alone as its own paragraph is
// embedded. Anywhere else it is just text, so a link mentioned mid-sentence
// stays a link mentioned mid-sentence.

export type BodyBlock =
  | { kind: 'text'; text: string }
  | { kind: 'image'; url: string; caption: string }
  | { kind: 'youtube'; id: string; start: number };

const IMAGE_LINE = /^!\[([^\]\n]*)\]\((\S+?)\)$/;

// Only addresses a browser will fetch as a picture: https, or one of ours.
// No javascript:, data: or plain http (mixed content on an https page).
function safeImageUrl(raw: string): string | null {
  const url = raw.trim();
  if (url.startsWith('/') && !url.startsWith('//')) return url;
  try {
    return new URL(url).protocol === 'https:' ? url : null;
  } catch {
    return null;
  }
}

// "1h2m3s", "90s", "90" → seconds.
function seconds(t: string | null): number {
  if (!t) return 0;
  if (/^\d+$/.test(t)) return Number(t);
  const m = t.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/);
  if (!m) return 0;
  return Number(m[1] || 0) * 3600 + Number(m[2] || 0) * 60 + Number(m[3] || 0);
}

/** The video id behind any of the usual YouTube link shapes, or null. */
export function youtubeId(raw: string): { id: string; start: number } | null {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return null;
  }
  const host = u.hostname.replace(/^(www|m|music)\./, '');
  let id: string | null = null;
  if (host === 'youtu.be') id = u.pathname.slice(1).split('/')[0];
  else if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
    if (u.pathname === '/watch') id = u.searchParams.get('v');
    else {
      const m = u.pathname.match(/^\/(?:embed|shorts|live|v)\/([^/?#]+)/);
      id = m ? m[1] : null;
    }
  }
  if (!id || !/^[A-Za-z0-9_-]{11}$/.test(id)) return null;
  return { id, start: seconds(u.searchParams.get('t') || u.searchParams.get('start')) };
}

export function parseBody(body: string): BodyBlock[] {
  return body
    .split(/\n\s*\n/)
    .map((x) => x.trim())
    .filter(Boolean)
    .map((p): BodyBlock => {
      const img = p.match(IMAGE_LINE);
      if (img) {
        const url = safeImageUrl(img[2]);
        if (url) return { kind: 'image', url, caption: img[1].trim() };
      }
      if (!/\s/.test(p)) {
        const yt = youtubeId(p);
        if (yt) return { kind: 'youtube', ...yt };
      }
      return { kind: 'text', text: p };
    });
}

/** Just the words — for word counts, reading time and excerpts. */
export function bodyText(body: string): string {
  return parseBody(body)
    .map((b) => (b.kind === 'text' ? b.text : b.kind === 'image' ? b.caption : ''))
    .filter(Boolean)
    .join('\n\n');
}

export function wordCount(body: string): number {
  const t = bodyText(body).trim();
  return t ? t.split(/\s+/).length : 0;
}

/** The line to drop into the body for a picture. Brackets in a caption would end it early. */
export function imageLine(url: string, caption: string): string {
  return `![${caption.replace(/[[\]\n]/g, ' ').replace(/\s+/g, ' ').trim()}](${url.trim().replace(/\s/g, '%20')})`;
}
