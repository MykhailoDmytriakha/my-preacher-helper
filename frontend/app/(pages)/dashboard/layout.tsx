'use client';

import { ReactNode } from "react";
import DashboardNav from "@/components/navigation/DashboardNav";
import { GuestBanner } from '@components/GuestBanner';
import ProtectedRoute from '@/components/ProtectedRoute';

export default function DashboardLayout({ 
  children 
}: { 
  children: ReactNode 
}) {
  return (
    <ProtectedRoute>
      <div className="min-h-screen bg-white dark:bg-gray-900">
        <DashboardNav />
        <GuestBanner />
        <main className="max-w-7xl mx-auto px-3 sm:px-4 md:px-6 lg:px-8 py-4 sm:py-6 md:py-8">
          {children}
        </main>
        
        <footer className="mt-12 border-t border-gray-200 dark:border-gray-800">
          <div className="max-w-7xl mx-auto px-3 sm:px-4 md:px-6 lg:px-8 py-6 text-center text-sm text-gray-500 dark:text-gray-400">
            &copy; {new Date().getFullYear()} My Preacher Helper
          </div>
        </footer>
      </div>
    </ProtectedRoute>
  );
} 