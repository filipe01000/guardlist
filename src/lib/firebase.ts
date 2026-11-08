import { initializeApp, getApps } from 'firebase/app';
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged, type User } from 'firebase/auth';
import firebaseConfig from '../../firebase-applet-config.json';

const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const googleAuthProvider = new GoogleAuthProvider();

// Armazena o token de transporte em memória (nunca no localStorage)
let inMemoryIdToken: string | null = null;

export async function signInWithGooglePopup(): Promise<{ user: User; idToken: string }> {
  const credential = await signInWithPopup(auth, googleAuthProvider);
  const token = await credential.user.getIdToken();
  inMemoryIdToken = token;
  return { user: credential.user, idToken: token };
}

export async function signOutAccount(): Promise<void> {
  inMemoryIdToken = null;
  await signOut(auth);
}

export async function getActiveAuthIdToken(): Promise<string | null> {
  if (auth.currentUser) {
    inMemoryIdToken = await auth.currentUser.getIdToken();
  }
  return inMemoryIdToken;
}

export { onAuthStateChanged, type User };
