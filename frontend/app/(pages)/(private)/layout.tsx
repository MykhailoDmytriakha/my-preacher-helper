'use client';

import { ReactNode } from 'react';
import ProtectedRoute from '@/components/ProtectedRoute';
import DashboardNav from '@/components/navigation/DashboardNav';
import { GuestBanner } from '@components/GuestBanner';
import DevQuickNav from '@/components/navigation/DevQuickNav';

export default function PrivateLayout({ children }: { children: ReactNode }) {
  return (
    <ProtectedRoute>
      <div className="min-h-screen bg-white dark:bg-gray-900">
        <DashboardNav />
        <GuestBanner />
        <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 sm:py-6">
          {children}
        </main>
        <DevQuickNav />
      </div>
    </ProtectedRoute>
  );
}


