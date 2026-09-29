// Firebase Initialization and Authentication Module
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import { 
  getAuth, 
  GoogleAuthProvider, 
  signInWithPopup, 
  signInWithEmailAndPassword, 
  createUserWithEmailAndPassword, 
  onAuthStateChanged, 
  signOut, 
  updateProfile 
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';
import { 
  getFirestore, 
  doc, 
  setDoc, 
  getDoc, 
  getDocFromServer, 
  serverTimestamp 
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

// Firebase configuration for Street Safety System
export const firebaseConfig = {
  projectId: "crafty-text-n9brs",
  appId: "1:1069329822946:web:dd0ab5f3562e14a8025abb",
  apiKey: "AIzaSyBUjblNjexgd8BkUJ1Y0_1itTEebXVBnlo",
  authDomain: "crafty-text-n9brs.firebaseapp.com",
  firestoreDatabaseId: "ai-studio-streetsafetysyst-aa3685a5-a848-471f-b3d1-edeebe7aa98c",
  storageBucket: "crafty-text-n9brs.firebasestorage.app",
  messagingSenderId: "1069329822946",
  measurementId: "",
  oAuthClientId: "1069329822946-acg30lbu0p23u5cu5upv0q1ejul79bql.apps.googleusercontent.com",
  recaptchaSiteKey: ""
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);

export const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: 'select_account' });

export const OperationType = {
  CREATE: 'create',
  UPDATE: 'update',
  DELETE: 'delete',
  LIST: 'list',
  GET: 'get',
  WRITE: 'write'
};

export function handleFirestoreError(error, operationType, path) {
  const errInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid || null,
      email: auth.currentUser?.email || null,
      emailVerified: auth.currentUser?.emailVerified || null,
      isAnonymous: auth.currentUser?.isAnonymous || null,
      tenantId: auth.currentUser?.tenantId || null,
      providerInfo: auth.currentUser?.providerData?.map(provider => ({
        providerId: provider.providerId,
        email: provider.email,
      })) || []
    },
    operationType,
    path
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

// Connection test as required by Firebase integration guidelines
async function testFirestoreConnection() {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.warn("Please check your Firebase configuration.");
    }
  }
}
testFirestoreConnection();

/**
 * Synchronizes user profile with Firestore and backend session
 */
async function syncSession(user, providerId = 'google.com') {
  const email = user.email.toLowerCase();
  const displayName = user.displayName || email.split('@')[0];
  const uid = user.uid;
  const photoURL = user.photoURL || '';

  // 1. Sync with Firestore /users/{uid}
  try {
    await setDoc(doc(db, 'users', uid), {
      uid,
      email,
      displayName,
      photoURL,
      providerId,
      lastLoginAt: new Date().toISOString()
    }, { merge: true });
  } catch (fsErr) {
    console.warn('Firestore user profile sync warning:', fsErr.message);
  }

  // 2. Sync with backend API to issue unified session JWT & Cookie
  try {
    const res = await fetch('/api/firebase-auth', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, displayName, uid, providerId })
    });
    if (res.ok) {
      const data = await res.json();
      if (data.token) {
        localStorage.setItem('authToken', data.token);
      }
    }
  } catch (apiErr) {
    console.warn('Backend session sync warning:', apiErr.message);
  }

  localStorage.setItem('authUserEmail', email);
  localStorage.setItem('authDisplayName', displayName);
  localStorage.setItem('authProvider', providerId);
  localStorage.setItem('authUid', uid);

  return { email, displayName, uid };
}

/**
 * Sign In / Register using Google Account
 */
export async function signInWithGoogle() {
  const result = await signInWithPopup(auth, googleProvider);
  const user = result.user;
  return await syncSession(user, 'google.com');
}

/**
 * Register with Email and Password
 */
export async function registerWithEmailPassword(email, password, displayName) {
  const cleanEmail = email.trim().toLowerCase();
  const cleanName = (displayName || cleanEmail.split('@')[0]).trim();

  try {
    // Attempt Firebase native account creation
    const userCredential = await createUserWithEmailAndPassword(auth, cleanEmail, password);
    const user = userCredential.user;
    if (cleanName) {
      try {
        await updateProfile(user, { displayName: cleanName });
      } catch (pErr) {
        console.warn('Profile name update note:', pErr);
      }
    }
    return await syncSession(user, 'password');
  } catch (fbErr) {
    // If Email/Password provider is not yet enabled in Firebase Console,
    // seamlessly register via backend so user is never blocked!
    if (fbErr.code === 'auth/operation-not-allowed' || fbErr.code === 'auth/network-request-failed') {
      console.info('Using system auth fallback for email/password registration.');
      const res = await fetch('/api/register', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: cleanEmail, password, username: cleanName })
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Registration failed');
      }
      if (data.token) localStorage.setItem('authToken', data.token);
      localStorage.setItem('authUserEmail', cleanEmail);
      localStorage.setItem('authDisplayName', cleanName);
      localStorage.setItem('authProvider', 'local');
      return { email: cleanEmail, displayName: cleanName, uid: 'local_' + cleanEmail };
    }
    throw fbErr;
  }
}

/**
 * Sign In with Email and Password
 */
export async function loginWithEmailPassword(email, password) {
  const cleanEmail = email.trim().toLowerCase();

  try {
    const userCredential = await signInWithEmailAndPassword(auth, cleanEmail, password);
    return await syncSession(userCredential.user, 'password');
  } catch (fbErr) {
    // If not enabled or user was registered in system DB, fallback to backend login
    if (
      fbErr.code === 'auth/operation-not-allowed' || 
      fbErr.code === 'auth/user-not-found' || 
      fbErr.code === 'auth/invalid-credential' ||
      fbErr.code === 'auth/invalid-email'
    ) {
      const res = await fetch('/api/login', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: cleanEmail, password })
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Authentication rejected. Verify credentials.');
      }
      if (data.token) localStorage.setItem('authToken', data.token);
      const userEmail = (data.user && data.user.email) || cleanEmail;
      const userName = (data.user && data.user.username) || cleanEmail.split('@')[0];
      localStorage.setItem('authUserEmail', userEmail);
      localStorage.setItem('authDisplayName', userName);
      localStorage.setItem('authProvider', 'local');
      return { email: userEmail, displayName: userName, uid: 'local_' + userEmail };
    }
    throw fbErr;
  }
}

/**
 * Sign Out from all providers
 */
export async function logOut() {
  try {
    await signOut(auth);
  } catch (e) {
    console.warn('Firebase signout note:', e);
  }
  try {
    await fetch('/api/logout', { method: 'POST', credentials: 'include' });
  } catch (e) {
    console.warn('Backend logout note:', e);
  }
  localStorage.removeItem('authToken');
  localStorage.removeItem('authUserEmail');
  localStorage.removeItem('authDisplayName');
  localStorage.removeItem('authProvider');
  localStorage.removeItem('authUid');
}
