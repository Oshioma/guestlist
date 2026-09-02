// A LINK THAT LEAVES GUESTLIST.
//
// Ticket links go through /out/<id> so the click can be counted, which makes
// them look internal to anything grepping for http:// — and that is exactly
// how two of them ended up replacing the page somebody was reading. Somebody
// who taps "Get Tickets" is not done with the event: they want the tickets
// AND the page they were on, and on a phone "back" from a ticketing site is a
// coin toss.
//
// So every link out of Guestlist is one component, and the rule is stated
// once here rather than remembered at each call site.
//
// rel="noopener noreferrer" is not optional on a targeted link: without it the
// page we opened can reach back through window.opener.

import type { AnchorHTMLAttributes, ReactNode } from 'react';

type Props = AnchorHTMLAttributes<HTMLAnchorElement> & {
  href: string;
  children: ReactNode;
};

export function OutboundLink({ href, children, ...rest }: Props) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" {...rest}>
      {children}
    </a>
  );
}
