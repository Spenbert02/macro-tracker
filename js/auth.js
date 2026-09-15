/* auth.js — sign-in, and the reason this app has an email/password option.
 *
 * Google sign-in DOES NOT WORK in an installed iOS PWA, either way round:
 *   - signInWithPopup: since iOS 17.5 the popup's window.opener is null, so the
 *     auth handler's postMessage never reaches the app and it hangs forever.
 *   - signInWithRedirect: Safari's third-party storage blocking breaks it
 *     (Firebase documents this), and it navigates out of the manifest scope to
 *     <project>.firebaseapp.com, which iOS opens in a view the PWA can't return from.
 *
 * So: sign in with Google once on desktop, then link an email+password to that
 * SAME uid (linkPassword below). The phone signs in with the password — plain
 * first-party XHR, nothing to break — and indexedDBLocalPersistence keeps it
 * signed in from then on. The security rules never change, because the uid
 * never changes.
 */

import {
  GoogleAuthProvider, EmailAuthProvider,
  signInWithPopup, signInWithEmailAndPassword, getRedirectResult,
  linkWithCredential, reauthenticateWithCredential, updatePassword,
  onAuthStateChanged, signOut,
} from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js';
import { auth, authReady } from './firebase.js';

export const isStandalone = () =>
  (typeof matchMedia === 'function' && matchMedia('(display-mode: standalone)').matches) ||
  navigator.standalone === true;

export const isIOS = () =>
  /iPad|iPhone|iPod/.test(navigator.userAgent) ||
  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

/** Google sign-in is offered everywhere except an installed iOS PWA. */
export const canUseGoogle = () => !(isIOS() && isStandalone());

export async function signInWithGoogle() {
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  const cred = await signInWithPopup(auth, provider);
  return cred.user;
}

export async function signInWithPassword(email, password) {
  const cred = await signInWithEmailAndPassword(auth, email.trim(), password);
  return cred.user;
}

/** Attach an email+password credential to the CURRENT user, keeping the uid. */
export async function linkPassword(email, password) {
  const user = auth.currentUser;
  if (!user) throw new Error('Not signed in.');
  const credential = EmailAuthProvider.credential(email.trim(), password);
  if (hasPassword(user)) {
    // Already linked — this is a password change, which needs a fresh login.
    await reauthenticateWithCredential(user, credential).catch(() => {});
    await updatePassword(user, password);
    return user;
  }
  const res = await linkWithCredential(user, credential);
  return res.user;
}

export const hasPassword = (user) =>
  !!user?.providerData?.some((p) => p.providerId === 'password');

export const providerIds = (user) =>
  (user?.providerData || []).map((p) => p.providerId);

export const signOutNow = () => signOut(auth);

/** Resolves once the first auth state is known; then calls cb on every change. */
export async function observeAuth(cb) {
  await authReady;
  // Harmless if no redirect was in flight; catches a popup-blocked fallback.
  try { await getRedirectResult(auth); } catch (err) { console.warn('[auth] redirect result', err?.code); }
  return onAuthStateChanged(auth, cb, (err) => {
    console.error('[auth] state error', err);
    cb(null);
  });
}

const MESSAGES = {
  'auth/popup-blocked':              'Your browser blocked the sign-in popup. Allow popups for this site, or use the email and password form below.',
  'auth/popup-closed-by-user':       'Sign-in was cancelled.',
  'auth/cancelled-popup-request':    'Sign-in was cancelled.',
  'auth/invalid-credential':         'That email or password is not right.',
  'auth/wrong-password':             'That email or password is not right.',
  'auth/user-not-found':             'No account with that email. Sign in with Google on a desktop first, then set a password in Settings.',
  'auth/invalid-email':              "That doesn't look like an email address.",
  'auth/weak-password':              'Password needs to be at least 6 characters.',
  'auth/too-many-requests':          'Too many attempts. Wait a minute and try again.',
  'auth/network-request-failed':     "Can't reach Firebase. Check your connection.",
  'auth/requires-recent-login':      'For security, sign out and back in before changing your password.',
  'auth/email-already-in-use':       'That email is already attached to a different account.',
  'auth/credential-already-in-use':  'That email is already attached to a different account.',
  'auth/provider-already-linked':    'This account already has a password. Use it to sign in.',
  'auth/unauthorized-domain':        'This domain is not in the Firebase authorised-domains list. Add it in Authentication -> Settings.',
  'auth/operation-not-allowed':      'That sign-in method is not enabled in the Firebase console.',
  'auth/configuration-not-found':    'Firebase Authentication is not set up yet — enable a sign-in provider in the console.',
};

export const authError = (err) =>
  MESSAGES[err?.code] || err?.message?.replace(/^Firebase:\s*/, '') || 'Something went wrong.';
