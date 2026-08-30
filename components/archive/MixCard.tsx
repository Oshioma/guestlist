// A mix in Guestlist's own chrome: our card, our type, the platform's
// player inside it (embedding keeps playback on-site and is the licensed
// way to stream another platform's audio).

import Link from 'next/link';
import { MIX_PLATFORM_LABEL, parseMixUrl } from '@/lib/archive/mixes';

export type MixRow = {
  id: string;
  title: string;
  artist_name: string | null;
  platform: string;
  url: string;
  contributor: string | null;
  credit_contributor: boolean;
  event_title?: string;
  event_slug?: string;
  display_date?: string;
};

export function MixCard({ mix }: { mix: MixRow }) {
  const parsed = parseMixUrl(mix.url);
  if (!parsed) return null; // a bad row never breaks the page
  return (
    <div className="mixCard">
      <div className="mixCardHead">
        <span className="mixTitle">{mix.title}</span>
        {mix.artist_name && <span className="mixArtist">{mix.artist_name}</span>}
        <span className="mixPlatform">{MIX_PLATFORM_LABEL[parsed.platform]}</span>
      </div>
      <iframe
        className="mixFrame"
        src={parsed.embedSrc}
        height={parsed.height}
        loading="lazy"
        allow="autoplay; encrypted-media; picture-in-picture"
        title={mix.title}
      />
      {(mix.event_title || (mix.credit_contributor && mix.contributor)) && (
        <div className="mixFoot">
          {mix.event_title && mix.event_slug && (
            <Link href={`/archive/events/${mix.event_slug}`} className="mixEventLink">
              {mix.event_title}{mix.display_date && ` · ${mix.display_date}`}
            </Link>
          )}
          {mix.credit_contributor && mix.contributor && (
            <span className="mixCredit">Added by {mix.contributor}</span>
          )}
        </div>
      )}
    </div>
  );
}
