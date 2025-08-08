'use client';

import { ReactNode } from "react";

export default function DashboardLayout({ 
  children 
}: { 
  children: ReactNode 
}) {
  return (
    <div className="min-h-screen bg-white dark:bg-gray-900">
      <main className="mx-auto px-2 sm:px-4 md:px-6 lg:px-8 py-4 sm:py-6 md:py-8">
        {children}
      </main>
      <footer className="mt-12 border-t border-gray-200 dark:border-gray-800">
        <div className="mx-auto px-3 sm:px-4 md:px-6 lg:px-8 py-6 text-center text-sm text-gray-500 dark:text-gray-400">
          &copy; {new Date().getFullYear()} My Preacher Helper
        </div>
      </footer>
    </div>
  );
}