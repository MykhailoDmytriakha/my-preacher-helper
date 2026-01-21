import { useAuth } from '@/providers/AuthProvider';
import { auth } from '@/services/firebaseAuth.service';

export function useResolvedUid(): { uid: string | undefined; isAuthLoading: boolean } {
  const { user, loading } = useAuth();

  if (user?.uid) {
    return { uid: user.uid, isAuthLoading: false };
  }

  if (typeof window === 'undefined') {
    return { uid: undefined, isAuthLoading: loading };
  }

  const resolveGuestUid = (): string | undefined => {
    try {
      const guestData = window.localStorage.getItem('guestUser');
      if (!guestData) {
        return undefined;
      }
      const parsed = JSON.parse(guestData) as { uid?: string };
      return parsed.uid;
    } catch (error) {
      console.error('useResolvedUid: error parsing guestUser', error);
      return undefined;
    }
  };

  if (loading) {
    const authUid = auth.currentUser?.uid;
    if (authUid) {
      return { uid: authUid, isAuthLoading: false };
    }

    const guestUid = resolveGuestUid();
    if (guestUid) {
      return { uid: guestUid, isAuthLoading: false };
    }

    return { uid: undefined, isAuthLoading: true };
  }

  try {
    const guestUid = resolveGuestUid();
    return { uid: guestUid, isAuthLoading: false };
  } catch (error) {
    console.error('useResolvedUid: error parsing guestUser', error);
    return { uid: undefined, isAuthLoading: false };
  }
}
