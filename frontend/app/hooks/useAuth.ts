import { signInWithEmailAndPassword } from "firebase/auth";
import { useRouter } from 'next/navigation';
import { useCallback } from "react";
import { useTranslation } from 'react-i18next';

import { useAuth as useAuthProvider } from '@/providers/AuthProvider';
import { debugLog } from "@/utils/debugMode";
import { signInWithGoogle, signInAsGuest, logOut, auth } from "@services/firebaseAuth.service";
import { updateUserProfile } from "@services/userSettings.service";

export function useAuth() {
  const { user, loading } = useAuthProvider();
  debugLog('🔐 useAuth: user:', user?.uid, 'loading:', loading);
  const router = useRouter();
  const { i18n } = useTranslation();

  const loginWithGoogle = useCallback(async () => {
    try {
      const userData = await signInWithGoogle();
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
