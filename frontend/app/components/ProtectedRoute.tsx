'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

import { useAuth } from '@/providers/AuthProvider';

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
      const guestData = localStorage.getItem('guestUser');
      const firebaseAuthData = localStorage.getItem('firebase:authUser');
      
      // Only if there are no authentication data at all
      if (!guestData && !firebaseAuthData) {
        console.log('No auth data found, redirecting to:', redirectTo);
        router.replace(redirectTo);
      } else {
        console.log('Auth data found, staying on current page');
      }
    }
  }, [user, loading, isCheckingAuth, router, redirectTo]);

  // Show loading spinner while checking authentication
  if (loading || isCheckingAuth) {
    return (
      <div className="min-h-screen bg-white dark:bg-gray-900 flex items-center justify-center">
        <div className="w-12 h-12 border-t-2 border-b-2 border-blue-500 rounded-full animate-spin" data-testid="loading-spinner"></div>
      </div>
    );
  }

  // Don't render children if user is not authenticated
  if (!user && !localStorage.getItem('guestUser')) {
    return (
      <div className="min-h-screen bg-white dark:bg-gray-900 flex items-center justify-center">
        <div className="w-12 h-12 border-t-2 border-b-2 border-blue-500 rounded-full animate-spin" data-testid="loading-spinner"></div>
      </div>
    );
  }

  return <>{children}</>;
} 