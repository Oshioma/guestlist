// A PROFILE NOBODY HAS WRITTEN.
//
// A spam signup exists to be indexed. It fills in nothing, because filling
// things in costs effort and the point was the URL — a page on a real domain
// that Google will crawl. Take the crawl away and most of the reason to make
// one goes with it.
//
// So: a profile where the person has written NOTHING is served with a noindex
// directive. Not hidden, not blocked, not deleted — anybody with the link
// still sees it, they still appear to members who search, and the moment they
// write one true thing about themselves the directive lifts on the next
// render. It costs a real member nothing, because a real member fills
// something in; the signup form even asks for a city and nags when it is
// blank.
//
// Deliberately generous. One field is enough. This is a filter for pages with
// literally no content, not a judgement about how interesting somebody is.

export type ProfileSignals = {
  // Null until they click the link in their inbox. An unproved address is
  // never offered to a search engine, whatever else is on the page.
  email_verified_at?: string | null;
  avatar_url?: string | null;
  bio?: string | null;
  home_city?: string | null;
  now_doing?: string | null;
  looking_for?: string | null;
  raving_since?: number | null;
};

export function hasWrittenSomething(member: ProfileSignals): boolean {
  return Boolean(
    member.avatar_url ||
    member.bio?.trim() ||
    member.home_city?.trim() ||
    member.now_doing?.trim() ||
    member.looking_for?.trim() ||
    member.raving_since
  );
}

// What to tell a crawler. Search engines read this; people never see it.
export function profileRobots(member: ProfileSignals) {
  if (member.email_verified_at === null) return { index: false, follow: false };
  return hasWrittenSomething(member)
    ? { index: true, follow: true }
    : { index: false, follow: false };
}
