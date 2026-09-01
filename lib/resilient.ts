// A page is more than its weakest band. The homepage carries a dozen
// optional sections — @guestlist observations, tonight, Balance, your people
// — and any one of them throwing (a table a migration has not created yet, a
// query timing out) used to take the whole page down with a server-side
// exception. That is never the right trade: the events people came for are
// still perfectly renderable.
//
// `optional` runs a secondary section's data fetch and, if it fails, logs
// loudly for us and returns the fallback so the section quietly disappears.
// It is deliberately NOT for the primary content of a page: if the events
// list itself cannot load, an empty page pretending everything is fine is
// worse than an error.

export async function optional<T>(label: string, fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    // Server logs are where this belongs: visible to us, invisible to the
    // visitor, and specific enough to name the section that broke.
    console.error(`[optional:${label}]`, err instanceof Error ? err.message : err);
    return fallback;
  }
}
