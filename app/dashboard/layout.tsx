'use client';

import { ReactNode, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { auth } from "@/lib/firebaseAuth";
import DashboardNav from "@components/DashboardNav";
import { GuestBanner } from '@components/GuestBanner';

export default function DashboardLayout({ 
  children 
}: { 
  children: ReactNode 
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = auth.onAuthStateChanged((user) => {
      setLoading(false);
      if (!user && !localStorage.getItem('guestUser')) {
        router.push('/');
      }
    });
    return () => unsubscribe();
  }, [router]);

  if (loading) {
    return <div className="min-h-screen bg-white dark:bg-gray-900" />;
  }

  return (
    <div className="min-h-screen bg-white dark:bg-gray-900">
      <DashboardNav />
      <GuestBanner />
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {children}
      </main>
    </div>
  );
} 