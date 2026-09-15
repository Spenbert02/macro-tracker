/* config.js — THE ONLY FILE YOU HAND-EDIT.
 *
 * See README.md for the full setup walkthrough. Two things go here:
 *   1. FIREBASE_CONFIG — from Firebase console -> Project settings -> Your apps -> Web
 *   2. OWNER_UID       — your own Firebase UID (the app shows it to you after you
 *                        first sign in). The SAME value must go in firestore.rules.
 *
 * None of this is secret. A Firebase web apiKey is a project identifier, not a
 * credential — Google documents it as safe to publish. All actual security lives
 * in firestore.rules, which is why those rules hardcode a single UID.
 */

export const FIREBASE_CONFIG = {
  apiKey: 'AIzaSyBtvmKZjMjROulP70uEdKVb4FiAskFujjk',
  authDomain: 'macro-tracker-84009.firebaseapp.com',
  projectId: 'macro-tracker-84009',
  storageBucket: 'macro-tracker-84009.firebasestorage.app',
  messagingSenderId: '907481951566',
  appId: '1:907481951566:web:847d7ca3c95358e07c821f',
};

/* Your Firebase UID. Until you set it, the app will sign you in and then show
 * you the UID to copy. Client-side guard only — the real gate is firestore.rules. */
export const OWNER_UID = 'PASTE_YOUR_UID_HERE';

/* Bump on EVERY deploy, together with VERSION in sw.js, or the service worker
 * will keep serving the old vendor bundles. */
export const APP_VERSION = '1.0.0';

/* Identifies us to Open Food Facts. A browser cannot set a User-Agent header
 * (it is a forbidden header name), so these ride along as query params instead. */
export const OFF_APP_NAME = 'macro-tracker';

/* ---------- derived ---------- */

export const isConfigured = () =>
  !Object.values(FIREBASE_CONFIG).some((v) => typeof v !== 'string' || v.startsWith('PASTE_'));

export const isOwnerSet = () => !OWNER_UID.startsWith('PASTE_');
