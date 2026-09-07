import { initializeApp, getApps, getApp, FirebaseApp } from 'firebase/app';
import { 
  initializeFirestore,
  Firestore, 
  doc, 
  getDoc, 
  setDoc,
  serverTimestamp 
} from 'firebase/firestore';
import { 
  getAuth, 
  Auth, 
  signInAnonymously, 
  onAuthStateChanged, 
  User 
} from 'firebase/auth';
import firebaseAppletConfig from '../../firebase-applet-config.json';
import { CloudPortfolioRecord } from '../types';

// Detect Firebase config from environment, imported applet config, or window injection
export function getFirebaseConfig(): Record<string, any> | null {
  const env = (import.meta as any).env || {};
  const win = typeof window !== 'undefined' ? (window as any) : {};

  if (win.__FIREBASE_CONFIG__) {
    return win.__FIREBASE_CONFIG__;
  }

  // Use the provisioned AI Studio Firebase Applet Config if available
  if (firebaseAppletConfig && firebaseAppletConfig.apiKey && firebaseAppletConfig.projectId) {
    return {
      apiKey: firebaseAppletConfig.apiKey,
      authDomain: firebaseAppletConfig.authDomain,
      projectId: firebaseAppletConfig.projectId,
      storageBucket: firebaseAppletConfig.storageBucket,
      messagingSenderId: firebaseAppletConfig.messagingSenderId,
      appId: firebaseAppletConfig.appId,
    };
  }

  // Fallback to Vite environment variables or defaults
  const projectId = env.VITE_FIREBASE_PROJECT_ID;
  const apiKey = env.VITE_FIREBASE_API_KEY;

  if (projectId && apiKey) {
    return {
      apiKey,
      authDomain: env.VITE_FIREBASE_AUTH_DOMAIN || `${projectId}.firebaseapp.com`,
      projectId,
      storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET || `${projectId}.appspot.com`,
      messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID || '',
      appId: env.VITE_FIREBASE_APP_ID || '',
    };
  }

  return null;
}

export function isFirebaseConfigured(): boolean {
  return getFirebaseConfig() !== null;
}

let appInstance: FirebaseApp | null = null;
let firestoreInstance: Firestore | null = null;
let authInstance: Auth | null = null;

export function getFirebaseApp(): FirebaseApp {
  if (!appInstance) {
    const existing = getApps();
    if (existing.length > 0) {
      appInstance = existing[0];
    } else {
      const config = getFirebaseConfig();
      if (!config) {
        throw new Error('Cloud backend not configured: Firebase configuration is missing.');
      }
      appInstance = initializeApp(config);
    }
  }
  return appInstance;
}

export function getAppFirestore(): Firestore {
  if (!firestoreInstance) {
    const app = getFirebaseApp();
    const databaseId = firebaseAppletConfig?.firestoreDatabaseId;

    // Use named databaseId if provisioned by AI Studio (e.g. ai-studio-apptracker-...)
    // or fallback to (default) if not specified
    const dbOptions = {
      experimentalAutoDetectLongPolling: true,
    };

    if (databaseId && databaseId !== '(default)') {
      firestoreInstance = initializeFirestore(app, dbOptions, databaseId);
    } else {
      firestoreInstance = initializeFirestore(app, dbOptions);
    }
  }
  return firestoreInstance;
}

export function getAppAuth(): Auth {
  if (!authInstance) {
    authInstance = getAuth(getFirebaseApp());
  }
  return authInstance;
}

/**
 * Fallback persistent device/browser UID when anonymous auth is restricted by Firebase admin
 */
export function getOrCreateClientUserId(): string {
  const KEY = 'xtb_portfolio_client_uid';
  try {
    let id = localStorage.getItem(KEY);
    if (!id) {
      id = 'client_' + Math.random().toString(36).substring(2, 10) + '_' + Date.now().toString(36);
      localStorage.setItem(KEY, id);
    }
    return id;
  } catch {
    return 'default_portfolio_client';
  }
}

/**
 * Ensures user identity for Firestore partitioning.
 * Attempts Firebase Auth first. If anonymous auth is disabled or restricted
 * (auth/admin-restricted-operation), seamlessly falls back to a persistent client UUID
 * stored in localStorage so cloud reads/writes proceed without error.
 */
export async function ensureAnonymousAuth(): Promise<{ uid: string }> {
  if (!isFirebaseConfigured()) {
    return { uid: getOrCreateClientUserId() };
  }

  try {
    const auth = getAppAuth();
    if (auth.currentUser) {
      return { uid: auth.currentUser.uid };
    }

    return await new Promise<{ uid: string }>((resolve) => {
      let isDone = false;
      const finish = (uid: string) => {
        if (!isDone) {
          isDone = true;
          try { unsubscribe(); } catch {}
          resolve({ uid });
        }
      };

      const unsubscribe = onAuthStateChanged(
        auth,
        (user) => {
          if (user) {
            finish(user.uid);
          }
        },
        (_err) => {
          finish(getOrCreateClientUserId());
        }
      );

      signInAnonymously(auth)
        .then((cred) => {
          finish(cred.user.uid);
        })
        .catch((_err) => {
          // Admin-restricted-operation or disabled anonymous auth: use persistent client ID
          finish(getOrCreateClientUserId());
        });

      // Quick timeout fallback
      setTimeout(() => {
        finish(getOrCreateClientUserId());
      }, 1500);
    });
  } catch (_error) {
    return { uid: getOrCreateClientUserId() };
  }
}