'use client';

// YOUR GUESTLIST — the member's own control surface: music taste (explicit
// + a transparent view of what we've inferred), rave history, places,
// travel plans, privacy and email. Members stay in control of their
// personalisation.

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

type Genre = { id: string; name: string; slug: string; parent_genre_id: string | null };
type TasteGenre = Genre & { explicit: boolean; inferred_score: number };

// ---------------------------------------------------------------------------
// WHAT DO YOU STILL LOVE? Progressive selection: parents first, subgenres
// appear for the families you pick. Never 100 checkboxes at once.
// ---------------------------------------------------------------------------

export function TastePanel({
  allGenres, explicit, inferred,
}: {
  allGenres: Genre[];
  explicit: TasteGenre[];
  inferred: TasteGenre[];
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set(explicit.map((g) => g.id)));
  const [busy, setBusy] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);

  const parents = allGenres.filter((g) => !g.parent_genre_id);
  const childrenOf = (id: string) => allGenres.filter((g) => g.parent_genre_id === id);
  const parentActive = (p: Genre) =>
    selected.has(p.id) || childrenOf(p.id).some((c) => selected.has(c.id));

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function save() {
    setBusy(true);
    const res = await fetch('/api/you/taste', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ genreIds: [...selected] }),
    });
    setBusy(false);
    if (res.ok) {
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 2000);
      router.refresh();
    }
  }

  return (
    <div className="youPanel" id="music">
      <h2 className="youPanelTitle">What do you still love?</h2>
      <p className="youPanelSub">
        Pick the sounds that matter to you — they anchor your recommendations.
      </p>
      <div className="chipRow">
        {parents.map((p) => (
          <button
            key={p.id}
            type="button"
            className={`chip${parentActive(p) ? ' active' : ''}`}
            onClick={() => toggle(p.id)}
          >
            {p.name}
          </button>
        ))}
      </div>
      {parents.filter(parentActive).map((p) => {
        const kids = childrenOf(p.id);
        if (!kids.length) return null;
        return (
          <div key={p.id} className="youSubGenres">
            <span className="youSubLabel">{p.name} →</span>
            {kids.map((c) => (
              <button
                key={c.id}
                type="button"
                className={`chip${selected.has(c.id) ? ' active' : ''}`}
                onClick={() => toggle(c.id)}
              >
                {c.name}
              </button>
            ))}
          </div>
        );
      })}
      <div className="youPanelActions">
        <button className="btnAccent" type="button" disabled={busy} onClick={save}>
          {savedFlash ? '✓ Saved' : 'Save my music'}
        </button>
      </div>
      {inferred.length > 0 && (
        <div className="youInferred">
          <div className="sectionLabel">Based on what you’ve been interested in</div>
          <p className="youPanelSub">
            We’ve also noticed you engaging with these — they influence your
            recommendations more gently, and adding them above makes them
            explicit. What you choose is never overwritten.
          </p>
          <div className="chipRow">
            {inferred.map((g) => (
              <button key={g.id} type="button" className="chip" onClick={() => { toggle(g.id); }}>
                + {g.name}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// WHERE DID YOU RAVE? Search → I WENT HERE → roughly when → what were you
// into. Missing place → CAN'T FIND IT? ADD IT (goes to moderation).
// ---------------------------------------------------------------------------

type SceneResult = {
  id: string; name: string; entity_type: string; city: string | null;
  country_name: string | null; active_from_year: number | null;
  active_to_year: number | null; attendee_count: number; status: string;
};
type HistoryItem = {
  id: string; entity_id: string; name: string; entity_type: string;
  city: string | null; country_name: string | null;
  from_year: number | null; to_year: number | null;
  genres: { id: string; name: string }[];
};

const ENTITY_TYPES = [
  ['club', 'Club'], ['party', 'Party / club night'], ['promoter', 'Promoter'],
  ['festival', 'Festival'], ['venue', 'Venue'], ['scene', 'Scene'],
];

export function HistoryPanel({
  initialHistory, parentGenres,
}: {
  initialHistory: HistoryItem[];
  parentGenres: Genre[];
}) {
  const [history, setHistory] = useState(initialHistory);
  const [q, setQ] = useState('');
  const [results, setResults] = useState<SceneResult[] | null>(null);
  const [adding, setAdding] = useState<SceneResult | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [fromYear, setFromYear] = useState('');
  const [toYear, setToYear] = useState('');
  const [genreSel, setGenreSel] = useState<Set<string>>(new Set());
  const [newPlace, setNewPlace] = useState({ name: '', entityType: 'club', city: '', country: '' });
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!q.trim()) { setResults(null); return; }
    const t = setTimeout(async () => {
      const res = await fetch(`/api/scene/search?q=${encodeURIComponent(q)}`).catch(() => null);
      if (res?.ok) setResults((await res.json()).results);
    }, 250);
    return () => clearTimeout(t);
  }, [q]);

  function resetForm() {
    setAdding(null); setShowNew(false); setFromYear(''); setToYear('');
    setGenreSel(new Set()); setQ(''); setResults(null);
    setNewPlace({ name: '', entityType: 'club', city: '', country: '' });
  }

  async function submit() {
    setBusy(true);
    setNotice(null);
    const body: Record<string, unknown> = {
      fromYear: fromYear || null,
      toYear: toYear || fromYear || null,
      genreIds: [...genreSel],
    };
    if (adding) body.entityId = adding.id;
    else body.newEntity = { ...newPlace, name: newPlace.name || q };
    const res = await fetch('/api/you/history', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (res.ok) {
      setHistory(data.history);
      if (data.entityCreated) {
        setNotice('Added — new places are checked by the Guestlist team before they appear in matching.');
      }
      resetForm();
    } else {
      setNotice(data.error ?? 'Something went wrong');
    }
  }

  async function remove(historyId: string) {
    const res = await fetch('/api/you/history', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ historyId }),
    });
    if (res.ok) setHistory((await res.json()).history);
  }

  const yearForm = (
    <div className="youHistoryForm">
      <div className="sectionLabel">Roughly when?</div>
      <div className="youYearRow">
        <input placeholder="From (1998)" value={fromYear} inputMode="numeric" maxLength={4}
               onChange={(e) => setFromYear(e.target.value.replace(/\D/g, ''))} />
        <input placeholder="To (2002)" value={toYear} inputMode="numeric" maxLength={4}
               onChange={(e) => setToYear(e.target.value.replace(/\D/g, ''))} />
        <span className="youPanelSub" style={{ margin: 0 }}>or leave blank — not sure is fine</span>
      </div>
      <div className="sectionLabel">What were you into?</div>
      <div className="chipRow">
        {parentGenres.map((g) => (
          <button key={g.id} type="button"
                  className={`chip${genreSel.has(g.id) ? ' active' : ''}`}
                  onClick={() => setGenreSel((prev) => {
                    const next = new Set(prev);
                    if (next.has(g.id)) next.delete(g.id); else next.add(g.id);
                    return next;
                  })}>
            {g.name}
          </button>
        ))}
      </div>
      <div className="youPanelActions">
        <button className="btnAccent" type="button" disabled={busy} onClick={submit}>
          Add to my history
        </button>
        <button className="btnGhost" type="button" onClick={resetForm}>Cancel</button>
      </div>
    </div>
  );

  return (
    <div className="youPanel" id="history">
      <h2 className="youPanelTitle">Where did you rave?</h2>
      <p className="youPanelSub">
        The clubs, parties and festivals that made you — anywhere in the
        world. This powers People From Your Scene.
      </p>

      {history.length > 0 && (
        <div className="youHistoryList">
          {history.map((h) => (
            <div className="youHistoryRow" key={h.id}>
              <div>
                <strong>{h.name}</strong>
                <span className="youHistoryMeta">
                  {' '}{[h.city, h.country_name].filter(Boolean).join(' · ')}
                  {h.from_year && ` · ${h.from_year}${h.to_year && h.to_year !== h.from_year ? `–${h.to_year}` : ''}`}
                  {h.genres.length > 0 && ` · ${h.genres.map((g) => g.name).join(', ')}`}
                </span>
              </div>
              <button className="recHide" type="button" onClick={() => remove(h.id)}>Remove</button>
            </div>
          ))}
        </div>
      )}

      {!adding && !showNew && (
        <>
          <input
            className="youSearch"
            placeholder="Where did you go? Try “Space”, “Metalheadz”, “The End”…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          {results && (
            <div className="youResults">
              {results.filter((r) => !history.some((h) => h.entity_id === r.id)).map((r) => (
                <div className="youResultRow" key={r.id}>
                  <div>
                    <strong>{r.name}</strong>
                    <span className="youHistoryMeta">
                      {' '}{[r.city, r.country_name].filter(Boolean).join(' · ')}
                      {r.active_from_year && ` · ${r.active_from_year}–${r.active_to_year ?? ''}`}
                      {r.attendee_count > 0 && ` · ${r.attendee_count} member${r.attendee_count === 1 ? '' : 's'} were there`}
                    </span>
                  </div>
                  <button className="btnGhost" type="button" onClick={() => setAdding(r)}>
                    I went here
                  </button>
                </div>
              ))}
              <button className="youAddMissing" type="button" onClick={() => {
                setShowNew(true);
                setNewPlace((p) => ({ ...p, name: q }));
              }}>
                Can’t find it? Add it →
              </button>
            </div>
          )}
        </>
      )}

      {adding && (
        <div className="youResults">
          <div className="youResultRow"><strong>{adding.name}</strong></div>
          {yearForm}
        </div>
      )}

      {showNew && (
        <div className="youResults">
          <div className="youNewGrid">
            <input placeholder="Name" value={newPlace.name}
                   onChange={(e) => setNewPlace({ ...newPlace, name: e.target.value })} />
            <select value={newPlace.entityType}
                    onChange={(e) => setNewPlace({ ...newPlace, entityType: e.target.value })}>
              {ENTITY_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
            <input placeholder="City" value={newPlace.city}
                   onChange={(e) => setNewPlace({ ...newPlace, city: e.target.value })} />
            <input placeholder="Country" value={newPlace.country}
                   onChange={(e) => setNewPlace({ ...newPlace, country: e.target.value })} />
          </div>
          {yearForm}
        </div>
      )}
      {notice && <div className="youNotice">{notice}</div>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// YOUR PLACES + WHERE ARE YOU GOING?
// ---------------------------------------------------------------------------

type Place = {
  id: string; name: string; slug: string; country_name: string | null; relation: 'home' | 'following';
};
type TravelPlan = {
  id: string; start_date: string; end_date: string; visibility: string;
  location_id: string; name: string; country_name: string | null;
};

export function PlacesPanel({ initialPlaces, initialPlans }: { initialPlaces: Place[]; initialPlans: TravelPlan[] }) {
  const router = useRouter();
  const [places, setPlaces] = useState(initialPlaces);
  const [plans, setPlans] = useState(initialPlans);
  const [cityQ, setCityQ] = useState('');
  const [cityResults, setCityResults] = useState<Place[] | null>(null);
  const [mode, setMode] = useState<'follow' | 'set_home'>('follow');
  const [trip, setTrip] = useState({ destination: '', country: '', startDate: '', endDate: '', visibility: 'private' });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!cityQ.trim()) { setCityResults(null); return; }
    const t = setTimeout(async () => {
      const res = await fetch(`/api/you/places?q=${encodeURIComponent(cityQ)}`).catch(() => null);
      if (res?.ok) setCityResults((await res.json()).results);
    }, 250);
    return () => clearTimeout(t);
  }, [cityQ]);

  async function placeAction(body: Record<string, unknown>) {
    setError(null);
    const res = await fetch('/api/you/places', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok) {
      setPlaces(data.places);
      setCityQ('');
      setCityResults(null);
      router.refresh();
    } else setError(data.error ?? 'Something went wrong');
  }

  async function addTrip(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const res = await fetch('/api/you/travel', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(trip),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok) {
      const listed = await fetch('/api/you/travel').then((r) => r.json()).catch(() => null);
      if (listed) setPlans(listed.plans);
      setTrip({ destination: '', country: '', startDate: '', endDate: '', visibility: 'private' });
      router.refresh();
    } else setError(data.error ?? 'Something went wrong');
  }

  async function removeTrip(planId: string) {
    await fetch('/api/you/travel', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ planId }),
    }).catch(() => {});
    setPlans((prev) => prev.filter((p) => p.id !== planId));
    router.refresh();
  }

  const home = places.find((p) => p.relation === 'home');
  const following = places.filter((p) => p.relation === 'following');

  return (
    <div className="youPanel" id="places">
      <h2 className="youPanelTitle">Your places</h2>
      <div className="youPlaceRow">
        <span className="sectionLabel" style={{ margin: 0 }}>Home</span>
        {home ? <span className="chip active">{home.name}{home.country_name ? `, ${home.country_name}` : ''}</span>
              : <span className="youPanelSub" style={{ margin: 0 }}>Not set</span>}
      </div>
      <div className="youPlaceRow">
        <span className="sectionLabel" style={{ margin: 0 }}>Following</span>
        {following.length === 0 && <span className="youPanelSub" style={{ margin: 0 }}>Follow the cities you care about</span>}
        {following.map((p) => (
          <button key={p.id} className="chip active" type="button" title="Unfollow"
                  onClick={() => placeAction({ action: 'unfollow', locationId: p.id })}>
            {p.name} ✕
          </button>
        ))}
      </div>
      <div className="youPlaceSearchRow">
        <select value={mode} onChange={(e) => setMode(e.target.value as 'follow' | 'set_home')}>
          <option value="follow">Follow a city</option>
          <option value="set_home">Set home city</option>
        </select>
        <input className="youSearch" style={{ margin: 0 }} placeholder="Zanzibar, London, Berlin, New York…"
               value={cityQ} onChange={(e) => setCityQ(e.target.value)} />
      </div>
      {cityResults && (
        <div className="youResults">
          {cityResults.map((r) => (
            <div className="youResultRow" key={r.id}>
              <div><strong>{r.name}</strong><span className="youHistoryMeta"> {r.country_name}</span></div>
              <button className="btnGhost" type="button"
                      onClick={() => placeAction({ action: mode, locationId: r.id })}>
                {mode === 'set_home' ? 'Set as home' : 'Follow'}
              </button>
            </div>
          ))}
          {cityQ.trim().length > 1 && (
            <button className="youAddMissing" type="button"
                    onClick={() => placeAction({ action: mode, newCity: { name: cityQ } })}>
              Add “{cityQ}” →
            </button>
          )}
        </div>
      )}

      <h2 className="youPanelTitle" style={{ marginTop: 26 }}>Where are you going?</h2>
      <p className="youPanelSub">
        Tell Guestlist about a trip and events there appear while it matters.
        Private by default — your dates are only shared if you choose.
      </p>
      {plans.map((p) => (
        <div className="youHistoryRow" key={p.id}>
          <div>
            <strong>{p.name}</strong>
            <span className="youHistoryMeta">
              {' '}{p.start_date} → {p.end_date} · {p.visibility}
            </span>
          </div>
          <button className="recHide" type="button" onClick={() => removeTrip(p.id)}>Remove</button>
        </div>
      ))}
      <form className="youTripForm" onSubmit={addTrip}>
        <input placeholder="Destination (Ibiza)" value={trip.destination} required
               onChange={(e) => setTrip({ ...trip, destination: e.target.value })} />
        <input type="date" value={trip.startDate} required
               onChange={(e) => setTrip({ ...trip, startDate: e.target.value })} />
        <input type="date" value={trip.endDate} required
               onChange={(e) => setTrip({ ...trip, endDate: e.target.value })} />
        <select value={trip.visibility} onChange={(e) => setTrip({ ...trip, visibility: e.target.value })}>
          <option value="private">Private</option>
          <option value="connections">Connections</option>
          <option value="public">Public</option>
        </select>
        <button className="btnAccent" type="submit">Add trip</button>
      </form>
      {error && <div className="formError">{error}</div>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Profile fields + privacy + email preferences.
// ---------------------------------------------------------------------------

type Privacy = Record<string, boolean>;
type EmailPrefs = Record<string, boolean | string>;
type ProfileFields = { bio: string | null; raving_since: number | null; now_doing: string | null; looking_for: string | null };

const PRIVACY_LABELS: [string, string][] = [
  ['profile_public', 'Public profile (visible to other members)'],
  ['show_taste', 'Show my music taste'],
  ['show_history', 'Show my rave history'],
  ['show_history_years', 'Show exact years on my history'],
  ['show_home_city', 'Show my home city'],
  ['show_going', 'Show me in Who’s Going lists'],
  ['scene_discovery', 'Include me in People From Your Scene'],
  ['allow_connection_requests', 'Allow connection requests'],
];

const EMAIL_LABELS: [string, string][] = [
  ['weekly_digest', 'Weekly personalised weekend picks'],
  ['followed_promoter_events', 'New events from promoters I follow'],
  ['followed_venue_events', 'New events at venues I follow'],
  ['followed_artist_events', 'New events from artists I follow'],
  ['genre_in_home_city', 'Events matching my music in my cities'],
  ['travel_events', 'Events during my travel dates'],
  ['connection_going', 'When a connection marks an event Going'],
  ['event_reminders', 'Reminders the day before events I’m going to'],
];

const FREQUENCIES: [string, string][] = [
  ['instant', 'As it happens'],
  ['daily', 'Daily digest'],
  ['weekly', 'Weekly only'],
  ['off', 'Off'],
];

export function SettingsPanel({
  initialPrivacy, initialEmailPrefs, initialProfile,
}: {
  initialPrivacy: Privacy;
  initialEmailPrefs: EmailPrefs;
  initialProfile: ProfileFields;
}) {
  const router = useRouter();
  const [privacy, setPrivacy] = useState(initialPrivacy);
  const [email, setEmail] = useState(initialEmailPrefs);
  const [profile, setProfile] = useState({
    bio: initialProfile.bio ?? '',
    ravingSince: initialProfile.raving_since ? String(initialProfile.raving_since) : '',
    nowDoing: initialProfile.now_doing ?? '',
    lookingFor: initialProfile.looking_for ?? '',
  });
  const [savedFlash, setSavedFlash] = useState(false);

  async function patch(body: Record<string, unknown>) {
    await fetch('/api/you/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).catch(() => {});
  }

  function togglePrivacy(key: string) {
    const next = { ...privacy, [key]: !privacy[key] };
    setPrivacy(next);
    patch({ privacy: { [key]: next[key] } });
  }
  function toggleEmail(key: string) {
    const next = { ...email, [key]: !email[key] };
    setEmail(next);
    patch({ emailPrefs: { [key]: next[key] } });
  }
  async function saveProfile(e: React.FormEvent) {
    e.preventDefault();
    await patch({ profile });
    setSavedFlash(true);
    setTimeout(() => setSavedFlash(false), 2000);
    router.refresh();
  }

  return (
    <div className="youPanel" id="settings">
      <h2 className="youPanelTitle">Your profile</h2>
      <form className="youProfileForm" onSubmit={saveProfile}>
        <textarea placeholder="About you — who you are culturally, not your job title"
                  value={profile.bio} maxLength={600} rows={3}
                  onChange={(e) => setProfile({ ...profile, bio: e.target.value })} />
        <div className="youNewGrid">
          <input placeholder="Raving since (1992)" value={profile.ravingSince} inputMode="numeric" maxLength={4}
                 onChange={(e) => setProfile({ ...profile, ravingSince: e.target.value.replace(/\D/g, '') })} />
          <input placeholder="Now (Hospitality · Property · Technology)" value={profile.nowDoing} maxLength={160}
                 onChange={(e) => setProfile({ ...profile, nowDoing: e.target.value })} />
          <input placeholder="Looking for (Interesting people · Parties · Travel)" value={profile.lookingFor} maxLength={160}
                 onChange={(e) => setProfile({ ...profile, lookingFor: e.target.value })} />
        </div>
        <div className="youPanelActions">
          <button className="btnAccent" type="submit">{savedFlash ? '✓ Saved' : 'Save profile'}</button>
        </div>
      </form>

      <h2 className="youPanelTitle" style={{ marginTop: 26 }}>Privacy</h2>
      <div className="youToggleList">
        {PRIVACY_LABELS.map(([key, label]) => (
          <label className="notifPrefRow" key={key}>
            <input type="checkbox" checked={!!privacy[key]} onChange={() => togglePrivacy(key)} />
            {label}
          </label>
        ))}
      </div>

      <h2 className="youPanelTitle" style={{ marginTop: 26 }}>Email & alerts</h2>
      <div className="youPlaceRow" style={{ marginBottom: 10 }}>
        <span className="sectionLabel" style={{ margin: 0 }}>Alert email frequency</span>
        <select
          value={String(email.alert_frequency ?? 'daily')}
          onChange={(e) => {
            const next = { ...email, alert_frequency: e.target.value };
            setEmail(next);
            patch({ emailPrefs: { alert_frequency: e.target.value } });
          }}
          style={{ background: 'var(--bg)', border: '1px solid var(--border-strong)', borderRadius: 8, color: 'var(--text)', padding: '8px 10px' }}
        >
          {FREQUENCIES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </div>
      <div className="youToggleList">
        {EMAIL_LABELS.map(([key, label]) => (
          <label className="notifPrefRow" key={key}>
            <input type="checkbox" checked={!!email[key]} onChange={() => toggleEmail(key)} />
            {label}
          </label>
        ))}
      </div>
    </div>
  );
}
