'use client';

import { ReactNode } from 'react';

import { GuestBanner } from '@/components/GuestBanner';
import Breadcrumbs from '@/components/navigation/Breadcrumbs';
import DashboardNav from '@/components/navigation/DashboardNav';
import DevQuickNav from '@/components/navigation/DevQuickNav';
import ProtectedRoute from '@/components/ProtectedRoute';

export default function PrivateLayout({ children }: { children: ReactNode }) {
  return (
    <ProtectedRoute>
      <div className="min-h-screen bg-white dark:bg-gray-900">
        <DashboardNav />
        <GuestBanner />
        <div className="mx-auto w-full px-4 sm:px-6 lg:px-8">
          <Breadcrumbs />
        </div>
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
    </ProtectedRoute>
  );
}

