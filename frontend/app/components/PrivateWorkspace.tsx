'use client';

import { ReactNode, useRef } from 'react';

import { AnalysisReshapeRecovery } from '@/components/bible/analysis/AnalysisReshapeRecovery';
import { SyncNoticeDock } from '@/components/common/SyncNoticeDock';
import { DeviceStorageNotice } from '@/components/DeviceStorageNotice';
import { TechnicalDetailsDialog } from '@/components/diagnostics/TechnicalDetailsButton';
import { DraftStorageNotice } from '@/components/DraftStorageNotice';
import { EngineConflictBanner } from '@/components/EngineConflictBanner';
import { GuestBanner } from '@/components/GuestBanner';
import Breadcrumbs from '@/components/navigation/Breadcrumbs';
import DashboardNav from '@/components/navigation/DashboardNav';
import DevQuickNav from '@/components/navigation/DevQuickNav';
import PageGestures from '@/components/navigation/PageGestures';
import { ShellHeaderProvider } from '@/components/navigation/shellHeader';
import { ShellTitlesProvider } from '@/components/navigation/shellTitles';
import { OfflinePageMemory } from '@/components/OfflinePageMemory';
import { OutboxConflictBanner } from '@/components/OutboxConflictBanner';
import { OutboxDrain } from '@/components/OutboxDrain';
import { SeriesMembershipRecovery } from '@/components/series/SeriesMembershipRecovery';
import { DataEngineWorkspace } from '@/data-engine/react.client';
import { useWorkspacePanes } from '@/hooks/useWorkspacePanes';
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
        <ShellTitlesProvider><ShellHeaderProvider>{children}</ShellHeaderProvider></ShellTitlesProvider>
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
  const bibleReader = pathname === '/bible' || pathname === '/bible/';
  const isStudyDetail = /^\/studies\/(?!share-links(?:\/|$))[^/]+\/?$/.test(pathname);
  const contentRef = useRef<HTMLElement | null>(null);
  useWorkspacePanes(contentRef, 'study', isStudyDetail);
  const isPreachingPlan = Boolean(
    pathname.startsWith('/sermons/') &&
      pathname.includes('/plan') &&
      new URLSearchParams(search).get('planView') === 'preaching'
  );

  const syncNotices = <><OutboxConflictBanner /><EngineConflictBanner search={search} /></>;
  const recovery = <><SeriesMembershipRecovery /><AnalysisReshapeRecovery /><UserSettingsSyncStatus /></>;
  return (
    // The page root itself moves under a swipe or a pull, so the gestures render it.
    <PageGestures data-study-workspace={isStudyDetail ? '' : undefined} className="min-h-screen bg-white dark:bg-gray-900">
      {/* Mounted OUTSIDE the conditional on purpose: the preaching-plan screen hides
          the chrome, and while the queue worker lived inside the banner that screen
          — the one a preacher keeps open for an hour — drained nothing at all. */}
      <OfflinePageMemory address={`${pathname}?${search}`} />
      <OutboxDrain />
      {!isPreachingPlan && (
        <>
          <DashboardNav syncNotices={bibleReader ? <SyncNoticeDock>{syncNotices}{recovery}</SyncNoticeDock> : undefined} />
          <GuestBanner />
          <div className="mx-auto w-full px-4 sm:px-6 lg:px-8">
            {/* Long Bible books expose the same recovery controls from the pinned header. */}
            {!bibleReader && syncNotices}
            {/* Device storage that stopped answering: records are copies for reading until it does. */}
            <DeviceStorageNotice />
            <DraftStorageNotice />
            <Breadcrumbs />
          </div>
        </>
      )}
      {!bibleReader && <div className="mx-auto w-full px-4 sm:px-6 lg:px-8">{recovery}</div>}
      <main
        ref={contentRef}
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
