'use client';

// Light ↔ dark, remembered per visitor via cookie so the server renders
// the chosen palette with no flash. Light is the default face of the site;
// dark is the original Guestlist night look.

export function ThemeToggle() {
  function toggle() {
    const root = document.documentElement;
    const next = root.dataset.theme === 'dark' ? 'light' : 'dark';
    if (next === 'dark') root.dataset.theme = 'dark';
    else delete root.dataset.theme;
    document.cookie = `gl_theme=${next}; path=/; max-age=31536000; samesite=lax`;
  }
  return (
    <button className="themeToggle" type="button" onClick={toggle}
            title="Switch light / dark" aria-label="Switch light or dark theme">
      ◐
    </button>
  );
}
