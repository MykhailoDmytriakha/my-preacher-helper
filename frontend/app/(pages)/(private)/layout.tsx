'use client';

import { usePathname, useSearchParams } from 'next/navigation';
import { ReactNode, Suspense } from 'react';

import { GuestBanner } from '@/components/GuestBanner';
import Breadcrumbs from '@/components/navigation/Breadcrumbs';
import DashboardNav from '@/components/navigation/DashboardNav';
import DevQuickNav from '@/components/navigation/DevQuickNav';
import ProtectedRoute from '@/components/ProtectedRoute';
import { isStudyEditRoute } from '@/utils/routes';

export default function PrivateLayout({ children }: { children: ReactNode }) {
  return (
    <ProtectedRoute>
      <Suspense fallback={null}>
        <PrivateLayoutContent>{children}</PrivateLayoutContent>
      </Suspense>
    </ProtectedRoute>
  );
}

function PrivateLayoutContent({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const isPreachingPlan = Boolean(
    pathname?.startsWith('/sermons/') &&
      pathname?.includes('/plan') &&
      searchParams?.get('planView') === 'preaching'
  );
  const isStudyEditFocus = Boolean(
    isStudyEditRoute(pathname)
  );
  const isFocusMode = isPreachingPlan || isStudyEditFocus;

  return (
    <div className="min-h-screen bg-white dark:bg-gray-900">
      {!isFocusMode && (
        <>
          <DashboardNav />
          <GuestBanner />
          <div className="mx-auto w-full px-4 sm:px-6 lg:px-8">
            <Breadcrumbs />
          </div>
        </>
      )}
      <main
        id="main-content"
        tabIndex={-1}
        role="main"
        aria-live="polite"
        className="mx-auto px-4 sm:px-6 lg:px-8 py-4 sm:py-6"
      >
        {children}
      </main>
      <DevQuickNav />
    </div>
  );
}
