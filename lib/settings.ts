// System settings — admin safety switches stored in the database so that
// stopping runaway email never requires a deployment.

import { query, queryOne } from './db';

export type SafetySwitches = {
  pause_recommendation_emails: boolean;
  pause_promoter_digests: boolean;
  pause_event_reminders: boolean;
  paused_alert_types: string[];
};

const DEFAULTS: SafetySwitches = {
  pause_recommendation_emails: false,
  pause_promoter_digests: false,
  pause_event_reminders: false,
  paused_alert_types: [],
};

export async function getSafetySwitches(): Promise<SafetySwitches> {
  const rows = await query<{ key: string; value: unknown }>(
    `select key, value from system_settings where key = any($1)`,
    [Object.keys(DEFAULTS)]
  );
  const out = { ...DEFAULTS };
  for (const r of rows) {
    if (r.key === 'paused_alert_types' && Array.isArray(r.value)) {
      out.paused_alert_types = r.value.filter((v) => typeof v === 'string');
    } else if (r.key in out && typeof r.value === 'boolean') {
      (out as Record<string, unknown>)[r.key] = r.value;
    }
  }
  return out;
}

export async function setSetting(key: string, value: unknown, updatedBy: string | null): Promise<void> {
  await query(
    `insert into system_settings (key, value, updated_by) values ($1, $2, $3)
     on conflict (key) do update set value = $2, updated_by = $3, updated_at = now()`,
    [key, JSON.stringify(value), updatedBy]
  );
}

export async function getSetting<T>(key: string): Promise<T | null> {
  const row = await queryOne<{ value: T }>(`select value from system_settings where key = $1`, [key]);
  return row?.value ?? null;
}

// Which optional sections appear in the site's main navigation. The pages
// themselves stay reachable by URL — this only controls the nav links, so a
// section can be hidden while it is still being built out.
export type NavVisibility = { explore: boolean; people: boolean };

const NAV_DEFAULTS: NavVisibility = { explore: true, people: true };

export async function getNavVisibility(): Promise<NavVisibility> {
  const value = await getSetting<Partial<NavVisibility>>('nav_visibility');
  return {
    explore: typeof value?.explore === 'boolean' ? value.explore : NAV_DEFAULTS.explore,
    people: typeof value?.people === 'boolean' ? value.people : NAV_DEFAULTS.people,
  };
}

export async function setNavVisibility(
  patch: Partial<NavVisibility>, updatedBy: string | null
): Promise<NavVisibility> {
  const current = await getNavVisibility();
  const next: NavVisibility = {
    explore: typeof patch.explore === 'boolean' ? patch.explore : current.explore,
    people: typeof patch.people === 'boolean' ? patch.people : current.people,
  };
  await setSetting('nav_visibility', next, updatedBy);
  return next;
}
