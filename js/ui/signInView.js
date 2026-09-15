/* signInView.js — sign-in, the setup screen, and the private-app gate.
 *
 * Everything here works with ZERO Firestore access. That is deliberate: the
 * security rules hardcode your uid, so before you have pasted it in, every read
 * is denied — and this is the screen that shows you the uid to paste.
 */

import { h, mount, icon, ICONS } from './dom.js';
import { signInWithGoogle, signInWithPassword, signOutNow, authError, canUseGoogle, isIOS, isStandalone } from '../auth.js';
import { OWNER_UID, isOwnerSet } from '../config.js';

const logo = () => h('img', { class: 'signin-logo', src: './assets/icon-192.png', alt: '', width: 62, height: 62 });

function errorBox() {
  const el = h('div', { class: 'alert', hidden: true });
  el.set = (msg) => { el.textContent = msg || ''; el.hidden = !msg; };
  return el;
}

/** Shown when config.js still has its PASTE_ placeholders. */
export function renderSetupNeeded(root) {
  mount(root, h('div', { class: 'signin' },
    logo(),
    h('h1', null, 'Almost there'),
    h('p', { class: 'sub' }, 'Macro Tracker needs a Firebase project before it can store anything.'),
    h('div', { class: 'card' },
      h('p', { class: 'small' }, 'Open ', h('code', null, 'js/config.js'), ' and paste in your Firebase web config. The full walkthrough is in ', h('code', null, 'README.md'), '.'),
      h('p', { class: 'small muted mt' }, 'Short version: create a free Firebase project, enable the Google and Email/Password sign-in providers, create a Firestore database in production mode, publish ', h('code', null, 'firestore.rules'), ', then copy the web config object from Project settings.'),
    ),
  ));
}

/** Signed in, but not as the owner — or the owner uid has not been set yet. */
export function renderNotOwner(root, user) {
  const uidBox = h('div', { class: 'uid-box' },
    h('code', null, user.uid),
    h('button', {
      class: 'btn btn-sm',
      onclick: async (ev) => {
        const btn = ev.currentTarget;
        try {
          await navigator.clipboard.writeText(user.uid);
          btn.textContent = 'Copied';
        } catch {
          // Clipboard API needs a secure context and can still be refused.
          btn.textContent = 'Select it';
          getSelection()?.selectAllChildren(uidBox.firstChild);
        }
        setTimeout(() => mount(btn, icon(ICONS.copy, 15), 'Copy'), 1600);
      },
    }, icon(ICONS.copy, 15), 'Copy'),
  );

  const firstRun = !isOwnerSet();

  mount(root, h('div', { class: 'signin' },
    logo(),
    h('h1', null, firstRun ? 'One more step' : 'This app is private'),
    h('p', { class: 'sub' }, firstRun
      ? 'You are signed in. Now tell the app and the database that this account is yours.'
      : 'This tracker only accepts one account, and it is not this one.'),

    firstRun
      ? h('div', { class: 'card' },
          h('p', { class: 'small' }, 'This is your Firebase user ID:'),
          uidBox,
          h('p', { class: 'small muted' }, 'Paste it into ', h('strong', null, 'both'), ' places, then reload:'),
          h('ol', { class: 'small muted', style: 'margin:8px 0 0;padding-left:20px;line-height:1.7' },
            h('li', null, h('code', null, 'OWNER_UID'), ' in ', h('code', null, 'js/config.js')),
            h('li', null, h('code', null, 'ownerUid()'), ' in the Firebase console under Firestore → Rules, then press ', h('strong', null, 'Publish')),
          ),
        )
      : h('div', { class: 'card' },
          h('p', { class: 'small muted' }, 'Signed in as ', h('strong', null, user.email || user.uid), '.'),
          h('p', { class: 'small muted mt' }, 'Expected account ends in ', h('code', null, OWNER_UID.slice(-6)), '.'),
          h('div', { class: 'uid-box' }, h('code', null, user.uid)),
        ),

    h('button', { class: 'btn btn-block mt', onclick: () => signOutNow() }, icon(ICONS.out, 17), 'Sign out'),
    h('p', { class: 'tiny faint center mt' }, 'Nothing can be read or written until the IDs match.'),
  ));
}

/** The signed-out screen. */
export function renderSignIn(root) {
  const err = errorBox();
  const email = h('input', { type: 'email', name: 'email', autocomplete: 'username', inputmode: 'email', placeholder: 'you@example.com', required: true });
  const pw    = h('input', { type: 'password', name: 'password', autocomplete: 'current-password', placeholder: 'Password', required: true });

  const busy = (btn, on, label) => {
    btn.disabled = on;
    btn.textContent = on ? 'Signing in…' : label;
  };

  const googleBtn = h('button', {
    class: 'btn btn-block',
    onclick: async (ev) => {
      const btn = ev.currentTarget;
      err.set('');
      busy(btn, true, 'Continue with Google');
      try { await signInWithGoogle(); }
      catch (e) { err.set(authError(e)); busy(btn, false, 'Continue with Google'); }
    },
  }, 'Continue with Google');

  const form = h('form', {
    onsubmit: async (ev) => {
      ev.preventDefault();
      const btn = ev.currentTarget.querySelector('button[type=submit]');
      err.set('');
      busy(btn, true, 'Sign in');
      try { await signInWithPassword(email.value, pw.value); }
      catch (e) { err.set(authError(e)); busy(btn, false, 'Sign in'); }
    },
  },
    h('label', { class: 'field' }, h('span', null, 'Email'), email),
    h('label', { class: 'field' }, h('span', null, 'Password'), pw),
    h('button', { class: 'btn btn-primary btn-block', type: 'submit' }, 'Sign in'),
  );

  const showGoogle = canUseGoogle();

  mount(root, h('div', { class: 'signin' },
    logo(),
    h('h1', null, 'Macro Tracker'),
    h('p', { class: 'sub' }, 'Sign in to see your data.'),
    err,

    showGoogle ? googleBtn : null,
    showGoogle ? h('div', { class: 'divider' }, 'or') : null,
    form,

    // Google sign-in genuinely cannot work here, so say why rather than
    // letting a button hang forever on a dead popup.
    !showGoogle
      ? h('p', { class: 'tiny faint center mt' },
          'Google sign-in does not work inside an installed iOS app. Use the password you set in Settings on your computer.')
      : null,

    isIOS() && !isStandalone()
      ? h('div', { class: 'ios-hint mt-lg' },
          h('div', { class: 'grow' }, h('strong', null, 'Add to Home Screen'), h('br'),
            'Tap Share, then “Add to Home Screen”, to use this like an app and keep the camera scanner one tap away.'))
      : null,
  ));
}
