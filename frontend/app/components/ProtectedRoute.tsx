'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

import { PageSpinner } from '@/components/ui/PageSpinner';
import { useAuth } from '@/providers/AuthProvider';

interface ProtectedRouteProps {
  children: React.ReactNode;
  redirectTo?: string;
}

export default function ProtectedRoute({ children, redirectTo = '/' }: ProtectedRouteProps) {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !user) router.replace(redirectTo);
  }, [user, loading, router, redirectTo]);

  // The provider waits for Firebase's persisted-session restoration. Storage keys and elapsed time
  // cannot prove that the person is signed in (BUG-20260810-auth-mirrors-in-localstorage).
  if (loading || !user) return <PageSpinner />;
  return <>{children}</>;
}
