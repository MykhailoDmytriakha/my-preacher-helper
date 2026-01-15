'use client';

import { User } from 'firebase/auth';
import React from 'react';
import { useTranslation } from 'react-i18next';

import { useUserSettings } from '@/hooks/useUserSettings';

interface UserSettingsSectionProps {
  user: User | null;
}

const UserSettingsSection: React.FC<UserSettingsSectionProps> = ({ user }) => {
  const { t } = useTranslation();
  const { settings, loading } = useUserSettings(user?.uid);

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