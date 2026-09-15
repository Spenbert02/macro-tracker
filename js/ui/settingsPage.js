/* settingsPage.js — targets, account, data. */

import { h, mount, icon, ICONS, debounce } from './dom.js';
import { getState, subscribe } from '../state.js';
import { deviceTz } from '../dates.js';
import { MACRO_LABEL, DEFAULT_TARGETS, DEFAULT_MODES, DEFAULT_BAND_PCT } from '../macros.js';
import { toast, toastOk, toastErr } from './toast.js';
import { friendly } from '../entryModel.js';
import { APP_VERSION } from '../config.js';
import { signOutNow, linkPassword, hasPassword, providerIds, authError } from '../auth.js';

const MODE_LABEL = {
  min:  'Green at or above target',
  max:  'Green at or below target',
  band: 'Green within a band of target',
};

let subs = [];

export function render(root) {
  subs.forEach((u) => u()); subs = [];

  const targetsCard = h('div', { class: 'card' });
  const accountCard = h('div', { class: 'card' });
  const dataCard    = h('div', { class: 'card' });
  const aboutCard   = h('div', { class: 'card' });

  mount(root,
    h('div', { class: 'section-head' }, h('h2', null, 'Daily targets')),
    targetsCard,
    h('div', { class: 'section-head' }, h('h2', null, 'Account')),
    accountCard,
    h('div', { class: 'section-head' }, h('h2', null, 'Your data')),
    dataCard,
    h('div', { class: 'section-head' }, h('h2', null, 'About')),
    aboutCard,
  );

  /* ---------------- targets ---------------- */

  const save = debounce(async (patch) => {
    try {
      const store = await import('../store.js');
      await store.saveProfile(getState().user.uid, patch);
    } catch (err) { toastErr(friendly(err)); }
  }, 700);

  function paintTargets() {
    const profile = getState().profile;
    if (!profile) return mount(targetsCard, h('div', { class: 'empty' }, 'Loading…'));

    const targets = { ...DEFAULT_TARGETS, ...profile.targets };
    const modes   = { ...DEFAULT_MODES,   ...profile.modes };
    const band    = profile.bandPct ?? DEFAULT_BAND_PCT;

    const rows = ['kcal', 'p', 'c', 'f'].map((k) => {
      const input = h('input', {
        type: 'number', inputmode: 'decimal', step: k === 'kcal' ? '10' : '1', min: '0',
        value: String(targets[k] ?? ''),
      });
      const select = h('select', null,
        ...Object.entries(MODE_LABEL).map(([v, label]) =>
          h('option', { value: v, selected: modes[k] === v }, label)));

      input.addEventListener('input', () => {
        const v = Number(input.value);
        if (Number.isFinite(v) && v >= 0) save({ targets: { ...targets, [k]: v } });
      });
      select.addEventListener('change', () => save({ modes: { ...modes, [k]: select.value } }));

      return h('div', { style: 'margin-bottom:18px' },
        h('div', { class: 'row', style: 'gap:12px' },
          h('label', { class: 'grow', style: 'font-weight:600' }, MACRO_LABEL[k],
            h('span', { class: 'faint small' }, k === 'kcal' ? '' : ' (g)')),
          h('div', { style: 'width:110px' }, input),
        ),
        h('div', { style: 'margin-top:8px' }, select),
      );
    });

    const bandInput = h('input', {
      type: 'number', inputmode: 'decimal', step: '1', min: '0', max: '50',
      value: String(Math.round(band * 100)),
    });
    bandInput.addEventListener('input', () => {
      const v = Number(bandInput.value);
      if (Number.isFinite(v) && v >= 0 && v <= 50) save({ bandPct: v / 100 });
    });

    /* Target rate of weight change. Negative loses, positive gains, 0 is off.
     * The Viewer draws this as a dashed line from the fitted starting weight of
     * whatever range you are looking at. */
    const gain = profile.targetGainLbPerMonth ?? 0;
    const gainInput = h('input', {
      type: 'number', inputmode: 'decimal', step: '0.5', min: '-30', max: '30', value: String(gain),
    });
    gainInput.addEventListener('input', () => {
      const v = Number(gainInput.value);
      if (Number.isFinite(v) && v >= -30 && v <= 30) save({ targetGainLbPerMonth: v });
    });

    const tzInput = h('input', { type: 'text', value: profile.tz || deviceTz() });
    tzInput.addEventListener('change', () => {
      const v = tzInput.value.trim();
      try { new Intl.DateTimeFormat('en-CA', { timeZone: v }); }
      catch { return toastErr(`"${v}" is not a timezone name. Try something like America/Chicago.`); }
      save({ tz: v });
      toastOk('Timezone updated');
    });

    mount(targetsCard,
      ...rows,
      h('div', { class: 'row', style: 'gap:12px' },
        h('label', { class: 'grow' },
          h('span', { style: 'font-weight:600' }, 'Band width'),
          h('div', { class: 'tiny faint' }, 'How far from a "band" target still counts as hitting it.')),
        h('div', { class: 'row', style: 'width:110px;gap:6px' }, bandInput, h('span', { class: 'muted' }, '%')),
      ),
      h('div', { class: 'section-head' }, h('h2', null, 'Weight goal')),
      h('div', { class: 'row', style: 'gap:12px' },
        h('label', { class: 'grow' },
          h('span', { style: 'font-weight:600' }, 'Target change'),
          h('div', { class: 'tiny faint' }, 'Negative to lose, positive to gain. 0 turns it off.')),
        h('div', { class: 'row', style: 'width:130px;gap:6px' }, gainInput, h('span', { class: 'muted small' }, 'lb/mo')),
      ),
      h('p', { class: 'tiny faint mt' },
        'The Viewer draws this as a dashed line on the weight chart, starting from your fitted weight at the beginning of whichever range you are looking at, so you can see whether you are tracking it.'),

      h('div', { class: 'section-head' }, h('h2', null, 'Timezone')),
      tzInput,
      h('p', { class: 'tiny faint mt' },
        'This decides when one day ends and the next begins. Food logged at 11pm should land on today, not tomorrow.'),
    );
  }

  /* ---------------- account ---------------- */

  function paintAccount() {
    const user = getState().user;
    if (!user) return;

    const uidBox = h('div', { class: 'uid-box' },
      h('code', null, user.uid),
      h('button', {
        class: 'btn btn-sm',
        onclick: async (ev) => {
          const btn = ev.currentTarget;
          try { await navigator.clipboard.writeText(user.uid); btn.textContent = 'Copied'; }
          catch { btn.textContent = 'Select it'; }
          setTimeout(() => mount(btn, icon(ICONS.copy, 15), 'Copy'), 1600);
        },
      }, icon(ICONS.copy, 15), 'Copy'),
    );

    const already = hasPassword(user);

    mount(accountCard,
      h('div', { class: 'row-between' },
        h('div', { class: 'grow' },
          h('div', { style: 'font-weight:600' }, user.email || 'Signed in'),
          h('div', { class: 'tiny faint' },
            providerIds(user).map((p) => (p === 'google.com' ? 'Google' : p === 'password' ? 'Password' : p)).join(' + ')),
        ),
      ),

      h('div', { class: 'section-head' }, h('h2', null, 'User ID')),
      uidBox,
      h('p', { class: 'tiny faint' }, 'This must match ', h('code', null, 'ownerUid()'), ' in your Firestore rules.'),

      h('div', { class: 'section-head' }, h('h2', null, already ? 'Change your password' : 'Set a password')),
      h('p', { class: 'small muted' }, already
        ? 'You already have a password on this account. You can change it here.'
        : 'Google sign-in does not work inside an installed iOS app. Set a password here on your computer, then use it to sign in on your phone — it is the same account either way.'),
      passwordForm(user, already),

      h('button', {
        class: 'btn btn-block mt-lg',
        onclick: async () => { if (confirm('Sign out?')) await signOutNow(); },
      }, icon(ICONS.out, 17), 'Sign out'),
    );
  }

  function passwordForm(user, already) {
    const email = h('input', { type: 'email', autocomplete: 'username', value: user.email || '', placeholder: 'you@example.com' });
    const pw    = h('input', { type: 'password', autocomplete: 'new-password', placeholder: 'At least 6 characters' });
    const pw2   = h('input', { type: 'password', autocomplete: 'new-password', placeholder: 'Type it again' });

    return h('form', {
      class: 'mt',
      onsubmit: async (ev) => {
        ev.preventDefault();
        const btn = ev.currentTarget.querySelector('button');
        if (pw.value.length < 6) return toastErr('Password needs at least 6 characters.');
        if (pw.value !== pw2.value) return toastErr('Those two passwords do not match.');
        btn.disabled = true;
        try {
          await linkPassword(email.value, pw.value);
          pw.value = pw2.value = '';
          toastOk(already ? 'Password changed' : 'Password set — you can now sign in with it on your phone.');
          paintAccount();
        } catch (err) { toastErr(authError(err)); }
        finally { btn.disabled = false; }
      },
    },
      h('label', { class: 'field' }, h('span', null, 'Email'), email),
      h('label', { class: 'field' }, h('span', null, 'Password'), pw),
      h('label', { class: 'field' }, h('span', null, 'Confirm'), pw2),
      h('button', { class: 'btn btn-block', type: 'submit' }, already ? 'Change password' : 'Set password'),
    );
  }

  /* ---------------- data ---------------- */

  mount(dataCard,
    h('button', {
      class: 'btn btn-block',
      onclick: async (ev) => {
        const btn = ev.currentTarget;
        btn.disabled = true;
        try {
          const store = await import('../store.js');
          const data = await store.exportAll(getState().user.uid);
          const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
          const url = URL.createObjectURL(blob);
          const a = h('a', { href: url, download: `macro-tracker-${new Date().toISOString().slice(0, 10)}.json` });
          document.body.append(a); a.click(); a.remove();
          setTimeout(() => URL.revokeObjectURL(url), 4000);
          toastOk(`Exported ${data.days.length} days`);
        } catch (err) { toastErr(friendly(err)); }
        finally { btn.disabled = false; }
      },
    }, icon(ICONS.download, 18), 'Export everything as JSON'),
    h('p', { class: 'tiny faint mt' },
      'Every day, food and meal you have saved, in one file. Your data lives in your own Firebase project — this is just a copy you can keep.'),
  );

  /* ---------------- about ---------------- */

  mount(aboutCard,
    h('div', { class: 'row-between' },
      h('span', { class: 'muted' }, 'Version'),
      h('code', null, APP_VERSION)),
    h('div', { class: 'row-between mt' },
      h('span', { class: 'muted' }, 'Connection'),
      h('span', null, getState().online ? 'Online' : 'Offline — changes will sync later')),
    h('button', {
      class: 'btn btn-block mt-lg',
      onclick: async () => {
        if (!('serviceWorker' in navigator)) return toast('No service worker to update.');
        const reg = await navigator.serviceWorker.getRegistration();
        if (!reg) return toast('Not installed as an app yet.');
        await reg.update();
        toast('Checked for updates.');
      },
    }, icon(ICONS.refresh, 17), 'Check for updates'),
  );

  /* ---------------- wire up ---------------- */

  subs.push(subscribe(['profile'], paintTargets));
  subs.push(subscribe(['user'], paintAccount));
  paintTargets();
  paintAccount();

  return { destroy() { subs.forEach((u) => u()); subs = []; save.flush(); } };
}
