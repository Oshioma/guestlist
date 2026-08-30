// Archive mixes: paste-a-link → embedded player, on-site.
//
// SECURITY: only three platforms are accepted and the iframe src is BUILT
// here from the parsed URL — raw user input never reaches an embed. Anything
// else is rejected with a clear message, which also guarantees every mix in
// the archive actually plays in-page.

export type MixPlatform = 'youtube' | 'soundcloud' | 'mixcloud';

export type ParsedMix = {
  platform: MixPlatform;
  canonicalUrl: string;
  embedSrc: string;
  height: number;
};

export function parseMixUrl(raw: string): ParsedMix | null {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return null;
  }
  if (!['http:', 'https:'].includes(u.protocol)) return null;
  const host = u.hostname.toLowerCase().replace(/^(www|m|music)\./, '');

  if (host === 'youtu.be' || host === 'youtube.com') {
    let id = host === 'youtu.be' ? (u.pathname.split('/')[1] ?? '') : (u.searchParams.get('v') ?? '');
    if (!id && /^\/(shorts|live|embed)\//.test(u.pathname)) id = u.pathname.split('/')[2] ?? '';
    if (!/^[A-Za-z0-9_-]{11}$/.test(id)) return null;
    return {
      platform: 'youtube',
      canonicalUrl: `https://www.youtube.com/watch?v=${id}`,
      embedSrc: `https://www.youtube-nocookie.com/embed/${id}`,
      height: 200,
    };
  }

  if (host === 'soundcloud.com') {
    const parts = u.pathname.split('/').filter(Boolean);
    if (parts.length < 2 || parts[0] === 'discover') return null;
    const canonical = `https://soundcloud.com/${parts.map(encodeURIComponent).join('/')}`;
    return {
      platform: 'soundcloud',
      canonicalUrl: canonical,
      // Widget takes the page URL; the accent colour matches Guestlist.
      embedSrc: `https://w.soundcloud.com/player/?url=${encodeURIComponent(canonical)}`
        + '&color=%23f2c94c&auto_play=false&hide_related=true&show_comments=false&show_teaser=false',
      height: 166,
    };
  }

  if (host === 'mixcloud.com') {
    const parts = u.pathname.split('/').filter(Boolean);
    if (parts.length < 2) return null;
    const feed = `/${parts.map(encodeURIComponent).join('/')}/`;
    return {
      platform: 'mixcloud',
      canonicalUrl: `https://www.mixcloud.com${feed}`,
      embedSrc: `https://player-widget.mixcloud.com/widget/iframe/?feed=${encodeURIComponent(feed)}`
        + '&hide_cover=1&light=0',
      height: 120,
    };
  }

  return null;
}

export const MIX_PLATFORM_LABEL: Record<MixPlatform, string> = {
  youtube: 'YouTube',
  soundcloud: 'SoundCloud',
  mixcloud: 'Mixcloud',
};
