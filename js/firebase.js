/* firebase.js — SDK init. Exports app, auth, db. Nothing else lives here. */

import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js';
import { getAuth, setPersistence, indexedDBLocalPersistence, browserLocalPersistence }
  from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js';
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager, CACHE_SIZE_UNLIMITED }
  from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js';
import { FIREBASE_CONFIG } from './config.js';

export const app = initializeApp(FIREBASE_CONFIG);

export const auth = getAuth(app);

/* Keep the session across PWA restarts. IndexedDB survives where the default
 * does not; fall back if a browser blocks it (private windows do). */
export const authReady = setPersistence(auth, indexedDBLocalPersistence)
  .catch(() => setPersistence(auth, browserLocalPersistence))
  .catch(() => {});

/* MUST run before the first read or write. Calling getFirestore(app) anywhere
 * ahead of this would silently lock the SDK to an in-memory cache — no offline
 * support, and no error to tell you. This is the whole offline story. */
export const db = initializeFirestore(app, {
  localCache: persistentLocalCache({
    tabManager: persistentMultipleTabManager(),
    cacheSizeBytes: CACHE_SIZE_UNLIMITED,
  }),
});
