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
import { CloudPortfolioRecord } from '../types';

// Detect Firebase config from environment or window injection
export function getFirebaseConfig(): Record<string, any> | null {
  const env = (import.meta as any).env || {};
  const win = typeof window !== 'undefined' ? (window as any) : {};

  if (win.__FIREBASE_CONFIG__) {
    return win.__FIREBASE_CONFIG__;
  }

  // Check Vite environment variables or fallback to project configuration
  const projectId = env.VITE_FIREBASE_PROJECT_ID || 'johnfolio-c82d3';
  const apiKey = env.VITE_FIREBASE_API_KEY || 'AIzaSyBPG0ajK6oWXiD-rmJMOB-trHhqpV6Vq5M';

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
    // experimentalAutoDetectLongPolling avoids the Firestore WebChannel
    // connection hanging indefinitely (perpetual "offline" state) behind
    // proxies that don't support streaming HTTP/gRPC well, such as the
    // GitHub Codespaces port-forwarding proxy.
    firestoreInstance = initializeFirestore(getFirebaseApp(), {
      experimentalAutoDetectLongPolling: true,
    });
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
 * Ensures anonymous authentication is active.
 * Firebase automatically persists anonymous credentials in IndexedDB/browser session.
 */
export async function ensureAnonymousAuth(): Promise<User> {
  const auth = getAppAuth();
  
  if (auth.currentUser) {
    return auth.currentUser;
  }

  return new Promise((resolve, reject) => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (user) {
        unsubscribe();
        resolve(user);
      } else {
        try {
          const userCredential = await signInAnonymously(auth);
          unsubscribe();
          resolve(userCredential.user);
        } catch (error) {
          unsubscribe();
          reject(error);
        }
      }
    }, (err) => {
      unsubscribe();
      reject(err);
    });
  });
}