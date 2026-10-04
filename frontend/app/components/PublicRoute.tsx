'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

import { PageSpinner } from '@/components/ui/PageSpinner';
import { useAuth } from '@/providers/AuthProvider';

interface PublicRouteProps {
  children: React.ReactNode;
  redirectTo?: string;
}

export default function PublicRoute({
  children,
  redirectTo = '/dashboard'
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
    return <PageSpinner />;
  }

  // Don't render children if user is authenticated
  if (user || localStorage.getItem('guestUser')) {
    return <PageSpinner />;
  }

  return <>{children}</>;
}
