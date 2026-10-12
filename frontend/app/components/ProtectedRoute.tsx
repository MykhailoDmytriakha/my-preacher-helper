'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

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
  const [isCheckingAuth, setIsCheckingAuth] = useState(true);

  useEffect(() => {
    // Give time for authentication state synchronization between tabs
    const authCheckTimer = setTimeout(() => {
      setIsCheckingAuth(false);
    }, 1000); // 1 second for synchronization

    return () => clearTimeout(authCheckTimer);
  }, []);

  useEffect(() => {
    // Wait for authentication check to complete
    if (isCheckingAuth) return;
    
    if (!loading && !user) {
      // Only if there are no authentication data at all
      if (!hasPersistedSession()) {
        console.log('No auth data found, redirecting to:', redirectTo);
        router.replace(redirectTo);
      } else {
        console.log('Auth data found, staying on current page');
      }
    }
  }, [user, loading, isCheckingAuth, router, redirectTo]);

  // Show loading spinner while checking authentication
  if (loading || isCheckingAuth) {
    return <PageSpinner />;
  }

  // Don't render children if user is not authenticated
  if (!user && !localStorage.getItem('guestUser')) {
    return <PageSpinner />;
  }

  return <>{children}</>;
} 