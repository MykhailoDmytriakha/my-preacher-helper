import { useState, useEffect, useCallback } from "react";
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, User } from "firebase/auth";
import { signInWithGoogle, signInAsGuest, logOut } from "@services/firebaseAuth.service";
import { updateUserProfile } from "@services/userSettings.service";
import { useRouter } from 'next/navigation';
import { useTranslation } from 'react-i18next';

export function useAuth() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();
  const { i18n } = useTranslation();
  const auth = getAuth();

  useEffect(() => {
    let isMounted = true;
    
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      if (isMounted) {
        setUser(currentUser);
        setLoading(false);
        if (!currentUser) {
          router.push('/');
        }
      }
    });
    
    return () => {
      isMounted = false;
      unsubscribe();
    };
  }, [router]);

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

  const handleLogout = useCallback(async () => {
    try {
      const currentLang = document.cookie.match(/lang=([^;]+)/)?.[1] || 'en';
      
      await logOut();
      localStorage.removeItem('guestUser');
      sessionStorage.clear();

      await i18n.changeLanguage(currentLang);
      document.cookie = `lang=${currentLang}; path=/; max-age=2592000`;
      
      router.push('/');
    } catch (error) {
      console.error('Logout failed:', error);
      router.refresh();
    }
  }, [router, i18n]);

  const loginWithEmailAndPassword = async (email: string, password: string) => {
    try {
      const userCredential = await signInWithEmailAndPassword(auth, email, password);
      setUser(userCredential.user);
      
      // Store user email and displayName in settings without affecting language
      await updateUserProfile(
        userCredential.user.uid,
        email,
        userCredential.user.displayName || undefined
      );
    } catch (error) {
      console.error('Email/password login error:', error);
      throw error;
    }
  };

  return { user, loading, loginWithGoogle, loginAsGuest, handleLogout, loginWithEmailAndPassword };
}
