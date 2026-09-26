// Light/dark switch for the docs/ write-ups. Load it in <head> so a saved choice applies before first paint.
// With no saved choice the page follows the system setting; docs.css reads data-theme on <html>.
(function () {
  const root = document.documentElement, KEY = 'manalath-docs-theme';
  try { const t = localStorage.getItem(KEY); if (t === 'light' || t === 'dark') root.dataset.theme = t; } catch (e) {}
  const system = matchMedia('(prefers-color-scheme: dark)');
  const isDark = () => root.dataset.theme ? root.dataset.theme === 'dark' : system.matches;
  const SUN = '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/>';
  const MOON = '<path d="M20.5 14.1A8.5 8.5 0 1 1 9.9 3.5a6.6 6.6 0 0 0 10.6 10.6z"/>';
  function mount() {
    const btn = document.createElement('button');
    btn.className = 'theme-toggle';
    const render = () => {
      const dark = isDark();
      btn.innerHTML = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${dark ? SUN : MOON}</svg>`;
      btn.setAttribute('aria-label', dark ? 'Switch to light mode' : 'Switch to dark mode');
      btn.title = btn.getAttribute('aria-label');
    };
    btn.addEventListener('click', () => {
      const next = isDark() ? 'light' : 'dark';
      root.dataset.theme = next;
      try { localStorage.setItem(KEY, next); } catch (e) {}
      render();
    });
    system.addEventListener('change', render);
    render();
    document.body.appendChild(btn);
  }
  if (document.body) mount(); else document.addEventListener('DOMContentLoaded', mount);
})();
