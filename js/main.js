/* main.js — boot sequence and the top-level gate.
 *
 *   register SW -> observe auth -> gate on OWNER_UID -> start watchers -> route
 */

import { APP_VERSION, OWNER_UID, isConfigured, isOwnerSet } from './config.js';
import { getState, setState, subscribe } from './state.js';
import { localDayKey, deviceTz } from './dates.js';
import { toast, toastErr } from './ui/toast.js';
import { onRoute, currentRoute } from './ui/router.js';
import { $, $$, mount, h } from './ui/dom.js';

const view   = $('#view');
const appEl  = $('#app');
const bootEl = $('#boot');
const tabbar = $('#tabbar');

let unsubs = [];
const dropWatchers = () => { unsubs.forEach((u) => { try { u(); } catch {} }); unsubs = []; };

const showApp = () => { bootEl.hidden = true; appEl.hidden = false; };

/* ---------------- boot ---------------- */

(async function boot() {
  if (!isConfigured()) {
    const { renderSetupNeeded } = await import('./ui/signInView.js');
    showApp();
    renderSetupNeeded(view);
    return;
  }

  let auth;
  try {
    auth = await import('./auth.js');
  } catch (err) {
    console.error('[boot] firebase failed to load', err);
    showApp();
    mount(view, h('div', { class: 'signin' },
      h('h1', null, 'Offline'),
      h('p', { class: 'sub' }, "Couldn't load Firebase. Check your connection and reload."),
      h('button', { class: 'btn btn-block', onclick: () => location.reload() }, 'Retry'),
    ));
    return;
  }

  registerServiceWorker();

  await auth.observeAuth(async (user) => {
    dropWatchers();
    setState({ user, profile: null, today: null, foods: [], meals: [], ready: false });
    showApp();

    if (!user) {
      tabbar.hidden = true;
      const { renderSignIn } = await import('./ui/signInView.js');
      renderSignIn(view);
      return;
    }

    if (!isOwnerSet() || user.uid !== OWNER_UID) {
      tabbar.hidden = true;
      const { renderNotOwner } = await import('./ui/signInView.js');
      renderNotOwner(view, user);
      return;
    }

    startSession(user);
  });
})();

/* ---------------- signed-in session ---------------- */

function startSession(user) {
  const uid = user.uid;
  const store = import('./store.js');

  tabbar.hidden = false;
  setState({ dayKey: getState().dayKey || localDayKey() });

  store.then((s) => {
    unsubs.push(s.watchProfile(uid, (profile, exists, err) => {
      if (err) return onPermissionError(err);
      setState({ profile, ready: true });
      // First run: write the defaults so Settings has something to edit.
      if (!exists) s.saveProfile(uid, s.blankProfile()).catch(() => {});
    }));

    unsubs.push(s.watchFoods(uid, (foods, err) => { if (!err) setState({ foods }); }));
    unsubs.push(s.watchMeals(uid, (meals, err) => { if (!err) setState({ meals }); }));

    watchCurrentDay(uid, s);
    unsubs.push(subscribe(['dayKey'], () => watchCurrentDay(uid, s)));
  });

  unsubs.push(onRoute(renderRoute));
  unsubs.push(watchDayRollover());
}

let dayUnsub = null;
function watchCurrentDay(uid, s) {
  if (dayUnsub) { dayUnsub(); dayUnsub = null; }
  const key = getState().dayKey;
  if (!key) return;
  dayUnsub = s.watchDay(uid, key, (day, pending, err) => {
    if (err) return onPermissionError(err);
    if (getState().dayKey !== key) return;      // a fast day-switch raced us
    setState({ today: day, pending });
  });
  unsubs.push(() => { if (dayUnsub) { dayUnsub(); dayUnsub = null; } });
}

/** If the app is left open past midnight, move to the new day on its own. */
function watchDayRollover() {
  const tick = () => {
    const st = getState();
    const tz = st.profile?.tz || deviceTz();
    const nowKey = localDayKey(new Date(), tz);
    // Only roll forward if they were sitting on what was "today" until midnight;
    // never yank them off a past day they deliberately navigated to.
    if (st.dayKey && st.dayKey < nowKey
        && st.dayKey === localDayKey(new Date(Date.now() - 864e5), tz)) {
      setState({ dayKey: nowKey });
    }
  };
  const id = setInterval(tick, 60_000);
  addEventListener('visibilitychange', tick);
  return () => { clearInterval(id); removeEventListener('visibilitychange', tick); };
}

let permissionErrorShown = false;
function onPermissionError(err) {
  console.error('[store]', err);
  if (err?.code !== 'permission-denied' || permissionErrorShown) return;
  permissionErrorShown = true;
  toastErr('The database refused that. Check that your UID is in firestore.rules and that you published the rules.', { timeout: 12000 });
}

/* ---------------- routing ---------------- */

let currentPage = null;
async function renderRoute(route) {
  $$('.tab').forEach((t) => {
    if (t.dataset.tab === route) t.setAttribute('aria-current', 'page');
    else t.removeAttribute('aria-current');
  });

  if (currentPage?.destroy) { try { currentPage.destroy(); } catch {} }
  currentPage = null;

  const mod = route === 'viewer'   ? await import('./ui/viewerPage.js')
            : route === 'settings' ? await import('./ui/settingsPage.js')
            :                        await import('./ui/entryPage.js');

  if (currentRoute() !== route) return;   // they tapped again while it loaded
  scrollTo(0, 0);
  currentPage = mod.render(view);
}

/* ---------------- service worker ---------------- */

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  if (location.protocol === 'file:') return;

  addEventListener('load', async () => {
    try {
      const reg = await navigator.serviceWorker.register('./sw.js');

      reg.addEventListener('updatefound', () => {
        const sw = reg.installing;
        if (!sw) return;
        sw.addEventListener('statechange', () => {
          // A new version is ready, but never reload out from under a
          // half-typed entry — offer it instead.
          if (sw.state === 'installed' && navigator.serviceWorker.controller) {
            toast('A new version is ready.', {
              timeout: 0,
              action: { label: 'Reload', onClick: () => location.reload() },
            });
          }
        });
      });
    } catch (err) {
      console.warn('[sw] registration failed', err);
    }
  });
}

console.info(`Macro Tracker ${APP_VERSION}`);
