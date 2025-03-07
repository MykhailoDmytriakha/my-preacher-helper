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
import { initializeUserSettings, updateUserProfile } from "@services/userSettings.service";
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
    toast.error("Ошибка входа в гостевой режим");
    throw error;
  }
};

export const signInWithGoogle = async (): Promise<User | null> => {
  try {
    const result = await signInWithPopup(auth, provider);
    console.log("User:", result.user);

    // Store user email and displayName without affecting language settings
    await updateUserProfile(
      result.user.uid,
      result.user.email || undefined,
      result.user.displayName || undefined
    );

    return result.user;
  } catch (error) {
    console.error("Error signing in:", error);
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
