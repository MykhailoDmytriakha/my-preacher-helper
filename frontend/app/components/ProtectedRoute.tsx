'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

import { PageSpinner } from '@/components/ui/PageSpinner';
import { useAuth } from '@/providers/AuthProvider';
import { hasPersistedSession } from '@/utils/persistedSession';

interface ProtectedRouteProps {
  children: React.ReactNode;
  redirectTo?: string;
}

export default function ProtectedRoute({ 
  children, 
  redirectTo = '/' 
}: ProtectedRouteProps) {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    // Firebase publishes the restored account and synchronizes it between tabs.
    if (!loading && !user) {
      // Only if there are no authentication data at all
      if (!hasPersistedSession()) {
        console.log('No auth data found, redirecting to:', redirectTo);
        router.replace(redirectTo);
      } else {
        console.log('Auth data found, staying on current page');
      }
    }
  }, [user, loading, router, redirectTo]);

  // Show loading spinner while checking authentication
  if (loading) {
    return <PageSpinner />;
  }

  // Don't render children if user is not authenticated
  if (!user && !localStorage.getItem('guestUser')) {
    return <PageSpinner />;
  }

  return <>{children}</>;
}
