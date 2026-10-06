'use client';

import { ReactNode } from 'react';

import { DeviceStorageNotice } from '@/components/DeviceStorageNotice';
import { DiagnosticsRecorder } from '@/components/diagnostics/DiagnosticsRecorder';
import { TechnicalDetailsDialog } from '@/components/diagnostics/TechnicalDetailsButton';
import { DraftStorageNotice } from '@/components/DraftStorageNotice';
import { EngineConflictBanner } from '@/components/EngineConflictBanner';
import { GuestBanner } from '@/components/GuestBanner';
import Breadcrumbs from '@/components/navigation/Breadcrumbs';
import DashboardNav from '@/components/navigation/DashboardNav';
import DevQuickNav from '@/components/navigation/DevQuickNav';
import PageGestures from '@/components/navigation/PageGestures';
import { ShellTitlesProvider } from '@/components/navigation/shellTitles';
import { OfflinePageMemory } from '@/components/OfflinePageMemory';
import { OutboxConflictBanner } from '@/components/OutboxConflictBanner';
import { OutboxDrain } from '@/components/OutboxDrain';
import { SeriesMembershipRecovery } from '@/components/series/SeriesMembershipRecovery';
import { DataEngineWorkspace } from '@/data-engine/react.client';
import { UserSettingsProvider, UserSettingsSyncStatus } from '@/providers/UserSettingsProvider';

/**
 * THE WORKSPACE OF EVERY PRIVATE PAGE (BUG-20261004-offline-shell-without-engine-workspace).
 * The private layout renders its pages here, and so does the offline shell, which the service
 * worker serves when an offline navigation misses the cache. A shell with its own set of
 * providers gave its pages no data engine: lists the device had saved came back empty. One
 * component for both keeps the data, the settings and the banners the same by construction.
 */
export function PrivateWorkspace({ children }: { children: ReactNode }) {
  return (
    <DataEngineWorkspace>
      <UserSettingsProvider>
        <TechnicalDetailsDialog />
        <ShellTitlesProvider>{children}</ShellTitlesProvider>
      </UserSettingsProvider>
    </DataEngineWorkspace>
  );
}

/**
 * The chrome around a private page. The address comes from the caller: the router knows it
 * online, while inside the offline shell the router stands at `/~offline` and only the
 * window knows which page was opened.
 */
export function PrivateChrome({ pathname, search, children }: { pathname: string; search: string; children: ReactNode }) {
  const isStudyDetail = /^\/studies\/(?!share-links(?:\/|$))[^/]+\/?$/.test(pathname);
  const isPreachingPlan = Boolean(
    pathname.startsWith('/sermons/') &&
      pathname.includes('/plan') &&
      new URLSearchParams(search).get('planView') === 'preaching'
  );

  return (
    // The page root itself moves under a swipe or a pull, so the gestures render it.
    <PageGestures data-study-workspace={isStudyDetail ? '' : undefined} className="min-h-screen bg-white dark:bg-gray-900">
      {/* Mounted OUTSIDE the conditional on purpose: the preaching-plan screen hides
          the chrome, and while the queue worker lived inside the banner that screen
          — the one a preacher keeps open for an hour — drained nothing at all. */}
      <DiagnosticsRecorder pathname={pathname} />
      <OfflinePageMemory address={`${pathname}?${search}`} />
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
            {/* The same door for engine writes the server refused after this device kept them. */}
            <EngineConflictBanner />
            {/* Device storage that stopped answering: records are copies for reading until it does. */}
            <DeviceStorageNotice />
            <DraftStorageNotice />
            <Breadcrumbs />
          </div>
        </>
      )}
      <div className="mx-auto w-full px-4 sm:px-6 lg:px-8"><SeriesMembershipRecovery /><UserSettingsSyncStatus /></div>
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
    </PageGestures>
  );
}
