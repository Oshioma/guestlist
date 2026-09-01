// What "working" means for a source. A source graduates out of the workbench
// once it is switched on, polling on a schedule, not failing, and actually
// producing events. Everything else — brand new, paused, failing, or polling
// away without ever yielding an event — stays on the bench where it can be
// tested and fixed.

export type SourceHealthInput = {
  active: boolean;
  polling_enabled: boolean;
  failure_count: number;
  events_found: number;
  linked_events: number;
};

export function isLiveSource(s: SourceHealthInput): boolean {
  return (
    s.active &&
    s.polling_enabled &&
    s.failure_count === 0 &&
    (s.events_found > 0 || s.linked_events > 0)
  );
}
