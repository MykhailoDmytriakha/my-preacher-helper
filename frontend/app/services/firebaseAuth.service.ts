import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  User,
  signOut,
  signInAnonymously,
  setPersistence,
  browserLocalPersistence,
} from "firebase/auth";
import app from "@/config/firebaseConfig";
import { toast } from "sonner";
import { updateUserProfile } from "@services/userSettings.service";
const GUEST_EXPIRATION_DAYS = 5;
export const auth = getAuth(app);
const provider = new GoogleAuthProvider();

// Use browserLocalPersistence for standard multi-tab behavior
setPersistence(auth, browserLocalPersistence);

export const checkGuestExpiration = (user: User): boolean => {
  if (!user.isAnonymous) return true;

  const creationTime = new Date(user.metadata.creationTime!).getTime();
  const expirationTime = creationTime + GUEST_EXPIRATION_DAYS * 86400 * 1000;
  return Date.now() < expirationTime;
};

export const signInWithGoogle = async (): Promise<User | null> => {
  try {
    console.log('Starting Google sign-in...');
    
    // Check Firebase configuration
    if (!process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN) {
      throw new Error('Firebase auth domain not configured');
    }
    
    const result = await signInWithPopup(auth, provider);
    console.log("User signed in:", result.user.uid);

    // Store user email and displayName without affecting language settings
    await updateUserProfile(
      result.user.uid,
      result.user.email || undefined,
      result.user.displayName || undefined
    );

    return result.user;
  } catch (error) {
    console.error("Error signing in with Google:", error);
    
    // Check for specific errors
    if (error instanceof Error) {
      if (error.message.includes('popup-closed')) {
        throw new Error('Sign-in popup was closed');
      } else if (error.message.includes('popup-blocked')) {
        throw new Error('Sign-in popup was blocked by browser');
      } else if (error.message.includes('network')) {
        throw new Error('Network error during sign-in');
      }
    }
    
    throw error;
  }
};

export const signInAsGuest = async (): Promise<User | null> => {
  try {
    console.log('Starting guest sign-in...');
    
    const result = await signInAnonymously(auth);
    console.log("Guest user signed in:", result.user.uid);
    
    localStorage.setItem(
      "guestUser",
      JSON.stringify({
        ...result.user,
        creationTime: new Date().toISOString(),
      })
    );

    // Store anonymous user information with placeholder email and name
    // without affecting language settings
    await updateUserProfile(
      result.user.uid,
      `guest-${result.user.uid.substring(0, 6)}@guest.local`, // placeholder email
      `Guest User ${result.user.uid.substring(0, 6)}` // placeholder name
    );

    return result.user;
  } catch (error) {
    console.error("Error signing in as guest:", error);
    toast.error("Guest sign-in error");
    throw error;
  }
};

export const logOut = async (): Promise<void> => {
  try {
    await signOut(auth);
    console.log("User logged out");
  } catch (error) {
    console.error("Error logging out:", error);
    throw error;
  }
};
