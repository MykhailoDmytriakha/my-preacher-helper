'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';

function isLocalhost(): boolean {
  if (typeof window === 'undefined') return false;
  const host = window.location.hostname;
  return host === 'localhost' || host === '127.0.0.1';
}

export default function DevQuickNav() {
  const [mounted, setMounted] = useState(false);
  const [sermonId, setSermonId] = useState<string>('');

  useEffect(() => {
    setMounted(true);
    try {
      const saved = localStorage.getItem('dev_sermon_id');
      if (saved) setSermonId(saved);
    } catch {}
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem('dev_sermon_id', sermonId);
    } catch {}
  }, [sermonId]);

  const enabled = useMemo(() => {
    const flag = process.env.NEXT_PUBLIC_ENABLE_DEV_NAV === '1';
    const envOk = process.env.NODE_ENV !== 'production';
    return mounted && isLocalhost() && envOk && flag;
  }, [mounted]);

  if (!enabled) return null;

  const disabledClass = 'opacity-50 pointer-events-none';

  return (
    <div className="fixed bottom-4 right-4 z-50">
      <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 shadow-lg rounded-lg p-3 w-72">
        <div className="text-xs font-semibold text-gray-600 dark:text-gray-300 mb-2">Dev Quick Nav (local only)</div>

        <div className="flex items-center gap-2 mb-2">
          <label htmlFor="dev-sermon-id" className="text-xs text-gray-500 dark:text-gray-400">sermonId</label>
          <input
            id="dev-sermon-id"
            type="text"
            value={sermonId}
            onChange={(e) => setSermonId(e.target.value.trim())}
            placeholder="e.g. test-sermon-id"
            className="flex-1 px-2 py-1 text-xs rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-200"
          />
        </div>

        <div className="grid grid-cols-2 gap-2 text-sm">
          <Link href="/dashboard" className="px-2 py-1 rounded bg-gray-100 dark:bg-gray-800 text-gray-800 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-700 transition">Dashboard</Link>
          <Link href="/settings" className="px-2 py-1 rounded bg-gray-100 dark:bg-gray-800 text-gray-800 dark:text-gray-200 hover:bg-gray-2 00 dark:hover:bg-gray-700 transition">Settings</Link>
          <Link href={sermonId ? `/sermons/${sermonId}` : '#'} className={`px-2 py-1 rounded bg-blue-50 dark:bg-blue-950/30 text-blue-700 dark:text-blue-300 hover:bg-blue-100 dark:hover:bg-blue-900 transition ${sermonId ? '' : disabledClass}`}>Sermon</Link>
          <Link href={sermonId ? `/sermons/${sermonId}/outline` : '#'} className={`px-2 py-1 rounded bg-purple-50 dark:bg-purple-950/30 text-purple-700 dark:text-purple-300 hover:bg-purple-100 dark:hover:bg-purple-900 transition ${sermonId ? '' : disabledClass}`}>Outline</Link>
          <Link href={sermonId ? `/sermons/${sermonId}/plan` : '#'} className={`px-2 py-1 rounded bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-100 dark:hover:bg-emerald-900 transition ${sermonId ? '' : disabledClass}`}>Plan</Link>
          <Link href={sermonId ? `/structure?sermonId=${encodeURIComponent(sermonId)}` : '#'} className={`px-2 py-1 rounded bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-amber-900 transition ${sermonId ? '' : disabledClass}`}>Structure</Link>
        </div>

        <div className="mt-2 text-[10px] text-gray-500 dark:text-gray-400">Set NEXT_PUBLIC_ENABLE_DEV_NAV=1 to enable.</div>
      </div>
    </div>
  );
}


