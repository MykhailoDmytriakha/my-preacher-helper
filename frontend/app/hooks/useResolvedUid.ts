import { useAuth } from '@/providers/AuthProvider';

/** React readers share the provider's completed Firebase restoration, including anonymous sessions. */
export function useResolvedUid(): { uid: string | undefined; isAuthLoading: boolean } {
  const { user, loading } = useAuth();
  return { uid: loading ? undefined : user?.uid, isAuthLoading: loading };
}
