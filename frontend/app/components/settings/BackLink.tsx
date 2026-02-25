'use client';

import { useRouter } from 'next/navigation';
import React from 'react';
import { useTranslation } from 'react-i18next';

import { BackArrowIcon } from '@components/Icons';

interface BackLinkProps {
  to?: string;   // fallback URL if no history
  label?: string;
}

const BackLink: React.FC<BackLinkProps> = ({ to = '/', label }) => {
  const { t } = useTranslation();
  const router = useRouter();

  const handleBack = () => {
    // If there's a previous page in history — go back there
    // Otherwise fall back to the provided `to` URL (defaults to dashboard)
    if (window.history.length > 1) {
      router.back();
    } else {
      router.push(to);
    }
  };

  return (
    <div className="flex items-center gap-2 mb-6">
      <button
        onClick={handleBack}
        className="flex items-center text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300"
      >
        <BackArrowIcon className="mr-1" />
        <span suppressHydrationWarning={true}>
          {label || t('settings.backToDashboard')}
        </span>
      </button>
    </div>
  );
};

export default BackLink;