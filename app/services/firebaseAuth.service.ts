import { getAuth, GoogleAuthProvider, signInWithPopup, User, signOut, signInAnonymously, setPersistence, browserLocalPersistence } from "firebase/auth";
import app from "../config/firebaseConfig";
import { log } from "@utils/logger";

export const auth = getAuth(app);
const provider = new GoogleAuthProvider();

// Add persistence setup
setPersistence(auth, browserLocalPersistence);

export const signInAsGuest = async (): Promise<User | null> => {
  try {
    const result = await signInAnonymously(auth);
    log.info("Anonymous User:", result.user);
    return result.user;
  } catch (error) {
    console.error("Error signing in anonymously:", error);
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