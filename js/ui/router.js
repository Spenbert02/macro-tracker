/* router.js — hash routing.
 *
 * Hash routing is not a style choice here. GitHub Pages has no SPA rewrite, so
 * /macro-tracker/viewer would 404. It also means the app never performs a real
 * navigation, which is what keeps the iOS camera stream alive between screens.
 */

const ROUTES = ['entry', 'viewer', 'settings'];
export const DEFAULT_ROUTE = 'entry';

export function currentRoute() {
  const r = location.hash.replace(/^#\/?/, '').split('?')[0];
  return ROUTES.includes(r) ? r : DEFAULT_ROUTE;
}

export function navigate(route, { replace = false } = {}) {
  const hash = `#/${route}`;
  if (location.hash === hash) return;
  if (replace) history.replaceState(null, '', hash);
  else location.hash = hash;
}

export function onRoute(cb) {
  const fire = () => cb(currentRoute());
  addEventListener('hashchange', fire);
  if (!location.hash) navigate(DEFAULT_ROUTE, { replace: true });
  fire();
  return () => removeEventListener('hashchange', fire);
}
