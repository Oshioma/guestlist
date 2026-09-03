'use client';

// THE FILTERS STOP WHEN THEY REACH THE NAVIGATION, AND STAY THERE.
//
// Scrolling a long list of events used to take the controls for narrowing it
// off the top of the screen — so changing your mind about a genre or a date
// meant scrolling all the way back up first. Anything that makes you undo your
// own scrolling to use a control is a control in the wrong place.
//
// It parks underneath the site header rather than at zero, which is why this
// is a component and not two lines of CSS: the header is not a fixed height.
// It grows an account strip when you sign in, and wraps to two rows on a
// narrow window. So the header measures itself and publishes its height as
// --headerH; the sticky band's top edge is that number.
//
// A ResizeObserver rather than a one-off read, because the height changes
// after first paint — a web font lands, the window narrows, the nav wraps.

import { useEffect, useRef } from 'react';

export function StickyFilters({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const header = document.querySelector('.siteHeader');
    if (!header) return;
    const root = document.documentElement;
    const publish = () => {
      // Round up: half a pixel short leaves a hairline of content sliding
      // through the gap, which reads as a rendering fault.
      root.style.setProperty('--headerH', `${Math.ceil(header.getBoundingClientRect().height)}px`);
    };
    publish();
    const ro = new ResizeObserver(publish);
    ro.observe(header);
    window.addEventListener('resize', publish);
    return () => { ro.disconnect(); window.removeEventListener('resize', publish); };
  }, []);

  return <div className="stickyFilters" ref={ref}>{children}</div>;
}
