'use client';

import { usePathname } from 'next/navigation';
import { ReactNode, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { DataFreshnessBanner } from '@/components/DataFreshnessBanner';
import LanguageInitializer from '@/components/navigation/LanguageInitializer';
import SettingsLayout from '@/components/settings/SettingsLayout';
import { useDocumentFreshness } from '@/hooks/useDocumentFreshness';
import { useFreshnessUid } from '@/hooks/useFreshnessUid';
import { useAuth } from '@/providers/AuthProvider';
import { contentFingerprint } from '@/utils/contentFingerprint';
import { sectionFromPathname } from '@/utils/settingsSections';
import SettingsNav from '@components/settings/SettingsNav';
import '@locales/i18n';

/**
 * THE SHELL LIVES IN THE LAYOUT SO THE SECTION CAN BE AN ADDRESS.
 *
 * Each section is its own route now, which is the only shape in which a link can point AT
 * one — "open plan settings" used to land on the first section whatever it meant. A route
 * per section would remount everything on every click if the shell sat in the page, so the
 * listener, the admin check and the freshness pill live here: a layout survives a change of
 * sibling segment, and only the content column is replaced.
 */
export default function SettingsSectionLayout({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const { user, loading } = useAuth();
  const pathname = usePathname();
  const [pageTitle, setPageTitle] = useState('');
  const [isAdmin, setIsAdmin] = useState(false);
  const [settingsFreshnessDismissed, setSettingsFreshnessDismissed] = useState(false);

  /**
   * SETTINGS ARE ALSO A DOCUMENT SOMEONE CAN CHANGE ELSEWHERE.
   *
   * They are in the coverage list and had nothing at all: no listener, no pill. A
   * preference changed on the phone left this screen showing the old value with no
   * hint — and every toggle here writes the field it owns, so the screen quietly
   * disagreed with the server until a reload.
   *
   * DELIBERATE LIMIT, recorded rather than hidden: writes stay per-field merges,
   * so two devices changing THE SAME preference hours apart is
   * last-writer-wins. That is a policy choice — a preference is one word the person
   * can simply set again, not text they composed — and it is written down in
   * BUGS.md instead of being implied away by an "always/never" promise.
   */
  type SettingsWatched = { fields: string };
  const settingsFreshnessUid = useFreshnessUid(user?.uid);
  const settingsFreshness = useDocumentFreshness<SettingsWatched>({
    collection: 'users',
    docId: user?.uid ?? null,
    uid: settingsFreshnessUid,
    enabled: Boolean(user?.uid),
    /**
     * This screen holds no copy of the settings document — each toggle fetches the
     * field it owns — so the FIRST server answer is what it opened with. Feeding the
     * hook's own `remote` back as `known` was a closed loop (`remote` is only filled
     * once the state is already stale), and live validation found the pill dead
     * because of it: a preference flipped on the phone showed nothing at all.
     */
    known: null,
    adoptFirstServerAnswerAsKnown: true,
    select: (data) => ({
      // Only the preferences this screen shows — usage counters and metering move
      // on their own and must not be reported as "someone edited your settings".
      fields: contentFingerprint({
        language: data.language ?? null,
        displayName: data.displayName ?? null,
        email: data.email ?? null,
        firstDayOfWeek: data.firstDayOfWeek ?? null,
        enablePrepMode: data.enablePrepMode ?? null,
        enableAudioGeneration: data.enableAudioGeneration ?? null,
        enableStructurePreview: data.enableStructurePreview ?? null,
        showAppVersion: data.showAppVersion ?? null,
        preferredProviderId: data.preferredProviderId ?? null,
        preferredModelId: data.preferredModelId ?? null,
      }),
    }),
  });

  useEffect(() => {
    if (settingsFreshness.state === 'stale' || settingsFreshness.state === 'unknown') {
      setSettingsFreshnessDismissed(false);
    }
  }, [settingsFreshness.remote, settingsFreshness.state]);

  useEffect(() => {
    // Set title on client-side to avoid hydration issues
    setPageTitle(t('settings.title'));
  }, [t]);

  useEffect(() => {
    let cancelled = false;
    setIsAdmin(false);
    if (!user || typeof user.getIdToken !== 'function') return;

    void (async () => {
      try {
        const token = await user.getIdToken();
        const response = await fetch('/api/admin/me', {
          headers: { Authorization: `Bearer ${token}` },
        });
        const data: unknown = await response.json().catch(() => null);
        const admin = response.ok
          && data !== null
          && typeof data === 'object'
          && 'admin' in data
          && data.admin === true;
        if (!cancelled) setIsAdmin(admin);
      } catch {
        if (!cancelled) setIsAdmin(false);
      }
    })();

    return () => { cancelled = true; };
  }, [user]);

  if (loading) {
    return (
      <SettingsLayout title={pageTitle}>
        <div className="flex justify-center items-center min-h-[60vh] text-gray-500 dark:text-gray-400">
          <div className="text-center">
            <svg className="animate-spin h-8 w-8 mx-auto mb-4 text-blue-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
            <p><span suppressHydrationWarning={true}>{t('settings.loading')}</span></p>
          </div>
        </div>
      </SettingsLayout>
    );
  }

  // Signed out is handled one layer up by ProtectedRoute; nothing of the person's own
  // belongs on screen while that decision is being made.
  if (!user) return null;

  const activeSection = sectionFromPathname(pathname);

  return (
    <>
      <LanguageInitializer />
      <SettingsLayout title={pageTitle}>
        {(settingsFreshness.state === 'stale' || settingsFreshness.state === 'unknown') &&
          !settingsFreshnessDismissed && (
            <DataFreshnessBanner
              entityKey="entitySettings"
              dirty={false}
              unknown={settingsFreshness.state === 'unknown'}
              diagnostics={settingsFreshness.diagnostics}
              checking={settingsFreshness.checking}
              canCheck={settingsFreshness.canCheck}
              onCheckAgain={settingsFreshness.checkAgain}
              onRefresh={() => {
                // Adopt what the server holds: nothing here is half-typed text, so
                // loading the newer values cannot destroy anything.
                if (settingsFreshness.remote) settingsFreshness.markSynced(settingsFreshness.remote);
                window.location.reload();
              }}
              onDismiss={() => setSettingsFreshnessDismissed(true)}
              className="mb-4"
            />
          )}
        {/* Mobile Navigation (horizontal, 2-column) - only visible on mobile */}
        <div className="block md:hidden mb-4">
          <div className="grid grid-cols-2 gap-1 p-2 bg-white dark:bg-gray-800 shadow rounded-lg">
            <SettingsNav activeSection={activeSection} isAdmin={isAdmin} />
          </div>
        </div>

        {/* One content tree at every viewport width; only navigation changes layout. */}
        <div className="md:flex md:flex-row md:gap-8">
          {/* Navigation sidebar for desktop */}
          <div className="hidden w-64 flex-shrink-0 md:block">
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-2 flex flex-col gap-1">
              <SettingsNav activeSection={activeSection} isAdmin={isAdmin} />
            </div>
          </div>

          {/* Shared content for mobile and desktop */}
          <div className="min-w-0 flex-1 transition-opacity duration-200 ease-in-out">
            {children}
          </div>
        </div>
      </SettingsLayout>
    </>
  );
}
