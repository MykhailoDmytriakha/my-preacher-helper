'use client';

import { usePathname, useSearchParams } from 'next/navigation';
import { ReactNode, Suspense } from 'react';

import { GuestBanner } from '@/components/GuestBanner';
import Breadcrumbs from '@/components/navigation/Breadcrumbs';
import DashboardNav from '@/components/navigation/DashboardNav';
import DevQuickNav from '@/components/navigation/DevQuickNav';
import { OutboxConflictBanner } from '@/components/OutboxConflictBanner';
import { OutboxDrain } from '@/components/OutboxDrain';
import ProtectedRoute from '@/components/ProtectedRoute';

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

  return (
    <div className="min-h-screen bg-white dark:bg-gray-900">
      {/* Mounted OUTSIDE the conditional on purpose: the preaching-plan screen hides
          the chrome, and while the queue worker lived inside the banner that screen
          — the one a preacher keeps open for an hour — drained nothing at all. */}
      <OutboxDrain />
      {!isPreachingPlan && (
        <>
          <DashboardNav />
          <GuestBanner />
          <div className="mx-auto w-full px-4 sm:px-6 lg:px-8">
            {/* An offline edit the server refused on replay. App-wide: the refusal
                surfaces on reconnect, when the person may be on another screen.
                Inside the existing gutter — its own container leaked into pages. */}
            <OutboxConflictBanner />
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
