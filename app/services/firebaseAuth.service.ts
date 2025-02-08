import { getAuth, GoogleAuthProvider, signInWithPopup, User, signOut, signInAnonymously, setPersistence, browserLocalPersistence } from "firebase/auth";
import app from "../config/firebaseConfig";
import { log } from "@utils/logger";
import { toast } from 'sonner';
const GUEST_EXPIRATION_DAYS = 5;
export const auth = getAuth(app);
const provider = new GoogleAuthProvider();

// Add persistence setup
setPersistence(auth, browserLocalPersistence);

export const checkGuestExpiration = (user: User): boolean => {
  if (!user.isAnonymous) return true;
  
  const creationTime = new Date(user.metadata.creationTime!).getTime();
  const expirationTime = creationTime + GUEST_EXPIRATION_DAYS * 86400 * 1000;
  return Date.now() < expirationTime;
};

export const signInAsGuest = async (): Promise<User | null> => {
  try {
    const result = await signInAnonymously(auth);
    localStorage.setItem('guestUser', JSON.stringify({
      ...result.user,
      creationTime: new Date().toISOString()
    }));
    return result.user;
  } catch (error) {
    toast.error('Ошибка входа в гостевой режим');
    throw error;
  }
};


export const signInWithGoogle = async (): Promise<User | null> => {
  try {
    const result = await signInWithPopup(auth, provider);
    log.info("User:", result.user);
    return result.user;
  } catch (error) {
    console.error("Error signing in:", error);
    throw error;
  }
};

export const logOut = async (): Promise<void> => {
  try {
    await signOut(auth);
    log.info("User logged out");
    window.location.href = '/';
  } catch (error) {
    console.error("Error logging out:", error);
    throw error;
  }
};