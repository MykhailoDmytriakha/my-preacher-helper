'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

import { useAuth } from '@/providers/AuthProvider';

interface PublicRouteProps {
  children: React.ReactNode;
  redirectTo?: string;
}

export default function PublicRoute({
  children,
  redirectTo = '/sermons'
}: PublicRouteProps) {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading) {
      const guestData = localStorage.getItem('guestUser');
      if (user || guestData) {
        router.replace(redirectTo);
      }
    }
  }, [user, loading, router, redirectTo]);

  // Show loading spinner while checking authentication
  if (loading) {
    return (
      <div className="min-h-screen bg-white dark:bg-gray-900 flex items-center justify-center">
        <div className="w-12 h-12 border-t-2 border-b-2 border-blue-500 rounded-full animate-spin" data-testid="loading-spinner"></div>
      </div>
    );
  }

  // Don't render children if user is authenticated
  if (user || localStorage.getItem('guestUser')) {
    return (
      <div className="min-h-screen bg-white dark:bg-gray-900 flex items-center justify-center">
        <div className="w-12 h-12 border-t-2 border-b-2 border-blue-500 rounded-full animate-spin" data-testid="loading-spinner"></div>
      </div>
    );
  }

  return <>{children}</>;
} 