'use client';

import { usePathname, useSearchParams } from 'next/navigation';
import { ReactNode, Suspense } from 'react';

import { PrivateChrome, PrivateWorkspace } from '@/components/PrivateWorkspace';
import ProtectedRoute from '@/components/ProtectedRoute';

export default function PrivateLayout({ children }: { children: ReactNode }) {
  return (
    <ProtectedRoute>
      <PrivateWorkspace>
        <Suspense fallback={null}>
          <RoutedChrome>{children}</RoutedChrome>
        </Suspense>
      </PrivateWorkspace>
    </ProtectedRoute>
  );
}

function RoutedChrome({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  return (
    <PrivateChrome pathname={pathname ?? '/'} search={searchParams?.toString() ?? ''}>
      {children}
    </PrivateChrome>
  );
}
