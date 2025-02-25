import { useState, useEffect, useCallback } from "react";
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, User } from "firebase/auth";
import { signInWithGoogle, signInAsGuest, logOut } from "@services/firebaseAuth.service";

export default function useAuth() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const auth = getAuth();

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (firebaseUser) => {
      setUser(firebaseUser);
      setLoading(false);
    });
    return unsubscribe;
  }, [auth]);

  const loginWithGoogle = useCallback(async () => {
    try {
      const userData = await signInWithGoogle();
      setUser(userData);
      localStorage.setItem("guestUser", JSON.stringify(userData));
      return userData;
    } catch (error) {
      console.error("Error signing in with Google", error);
      throw error;
    }
  }, []);

  const loginAsGuest = useCallback(async () => {
    try {
      const userData = await signInAsGuest();
      setUser(userData);
      localStorage.setItem("guestUser", JSON.stringify(userData));
      return userData;
    } catch (error) {
      console.error("Error signing in as guest", error);
      throw error;
    }
  }, []);

  const logoutUser = useCallback(async () => {
    try {
      await logOut();
      setUser(null);
      localStorage.removeItem("guestUser");
    } catch (error) {
      console.error("Error logging out", error);
      throw error;
    }
  }, []);

  const loginWithEmailAndPassword = async (email: string, password: string) => {
    try {
      const userCredential = await signInWithEmailAndPassword(auth, email, password);
      setUser(userCredential.user);
    } catch (error) {
      console.error('Email/password login error:', error);
      throw error;
    }
  };

  return { user, loading, loginWithGoogle, loginAsGuest, logoutUser, loginWithEmailAndPassword };
}
