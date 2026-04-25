'use client';

import { User } from 'firebase/auth';
import React from 'react';
import { useTranslation } from 'react-i18next';

import { useUserSettings } from '@/hooks/useUserSettings';
import { FirstDayOfWeek, normalizeFirstDayOfWeek } from '@/utils/weekStart';

interface UserSettingsSectionProps {
  user: User | null;
}

const UserSettingsSection: React.FC<UserSettingsSectionProps> = ({ user }) => {
  const { t } = useTranslation();
  const {
    settings,
    loading,
    updateFirstDayOfWeek,
    updatingFirstDayOfWeek
  } = useUserSettings(user?.uid);
  const [firstDayError, setFirstDayError] = React.useState<string | null>(null);
  const firstDayOfWeek = normalizeFirstDayOfWeek(settings?.firstDayOfWeek);

  const handleFirstDayOfWeekChange = async (value: FirstDayOfWeek) => {
    if (!user?.uid || updatingFirstDayOfWeek || value === firstDayOfWeek) {
      return;
    }

    setFirstDayError(null);
    try {
      await updateFirstDayOfWeek(value);
    } catch (error) {
      console.error('UserSettingsSection: failed to update first day of week:', error);
      setFirstDayError(t('settings.firstDayOfWeek.error'));
    }
  };

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-4 md:p-6">
      <h2 className="text-lg md:text-xl font-semibold mb-4 md:mb-6">
        <span suppressHydrationWarning={true}>{t('settings.userSettings')}</span>
      </h2>
      
      <div className="max-w-3xl space-y-4 md:space-y-6">
        {loading ? (
          <p className="text-gray-500 dark:text-gray-400">
            <span suppressHydrationWarning={true}>{t('settings.loadingUserData')}</span>
          </p>
        ) : user ? (
          <>
            <div className="flex flex-col md:flex-row md:items-center space-y-2 md:space-y-0 md:space-x-8 pb-4 border-b border-gray-200 dark:border-gray-700">
              <span className="font-medium text-gray-700 dark:text-gray-300 min-w-[120px] md:min-w-[150px]">
                <span suppressHydrationWarning={true}>{t('settings.email')}</span>:
              </span>
              <span className="text-gray-900 dark:text-gray-100 break-words">
                {settings?.email || user.email || <span suppressHydrationWarning={true}>{t('settings.noEmail')}</span>}
              </span>
            </div>
            
            <div className="flex flex-col md:flex-row md:items-center space-y-2 md:space-y-0 md:space-x-8 pb-4 border-b border-gray-200 dark:border-gray-700">
              <span className="font-medium text-gray-700 dark:text-gray-300 min-w-[150px]">
                <span suppressHydrationWarning={true}>{t('settings.userId')}</span>:
              </span>
              <span className="text-gray-900 dark:text-gray-100 break-all">{user.uid}</span>
            </div>
            
            <div className="flex flex-col md:flex-row md:items-center space-y-2 md:space-y-0 md:space-x-8 pb-4 border-b border-gray-200 dark:border-gray-700">
              <span className="font-medium text-gray-700 dark:text-gray-300 min-w-[150px]">
                <span suppressHydrationWarning={true}>{t('settings.displayName')}</span>:
              </span>
              <span className="text-gray-900 dark:text-gray-100">
                {settings?.displayName || user.displayName || <span suppressHydrationWarning={true}>{t('settings.noDisplayName')}</span>}
              </span>
            </div>

            <div className="flex flex-col gap-3 pb-4 border-b border-gray-200 dark:border-gray-700 md:flex-row md:items-center md:justify-between">
              <div className="md:max-w-md">
                <p className="font-medium text-gray-700 dark:text-gray-300">
                  <span suppressHydrationWarning={true}>{t('settings.firstDayOfWeek.title')}</span>
                </p>
                <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                  <span suppressHydrationWarning={true}>{t('settings.firstDayOfWeek.description')}</span>
                </p>
                {firstDayError && (
                  <p className="mt-2 text-sm text-red-600 dark:text-red-400">
                    {firstDayError}
                  </p>
                )}
              </div>
              <div
                className="inline-flex w-full rounded-lg border border-gray-200 bg-gray-50 p-1 dark:border-gray-700 dark:bg-gray-900 md:w-auto"
                role="group"
                aria-label={t('settings.firstDayOfWeek.title')}
              >
                {(['sunday', 'monday'] as const).map((option) => {
                  const selected = firstDayOfWeek === option;

                  return (
                    <button
                      key={option}
                      type="button"
                      onClick={() => handleFirstDayOfWeekChange(option)}
                      disabled={updatingFirstDayOfWeek}
                      className={`flex-1 rounded-md px-4 py-2 text-sm font-semibold transition-colors md:flex-none ${selected
                        ? 'bg-white text-blue-700 shadow-sm dark:bg-gray-700 dark:text-blue-200'
                        : 'text-gray-600 hover:bg-white/80 dark:text-gray-300 dark:hover:bg-gray-800'
                        } disabled:cursor-not-allowed disabled:opacity-60`}
                      aria-pressed={selected}
                    >
                      <span suppressHydrationWarning={true}>
                        {t(`settings.firstDayOfWeek.${option}`)}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
            
            <div className="pt-4 mt-4">
              <p className="text-gray-500 dark:text-gray-400 italic text-center md:text-left">
                <span suppressHydrationWarning={true}>{t('settings.moreSettingsSoon')}</span>
              </p>
            </div>
          </>
        ) : (
          <p className="text-gray-500 dark:text-gray-400">
            <span suppressHydrationWarning={true}>{t('settings.loadingUserData')}</span>
          </p>
        )}
      </div>
    </div>
  );
};

export default UserSettingsSection;
