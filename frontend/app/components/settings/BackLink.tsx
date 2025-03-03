'use client';

import React from 'react';
import Link from 'next/link';
import { useTranslation } from 'react-i18next';
import { BackArrowIcon } from '@components/Icons';

interface BackLinkProps {
  to: string;
  label?: string;
}

const BackLink: React.FC<BackLinkProps> = ({ to, label }) => {
  const { t } = useTranslation();
  
  return (
    <div className="flex items-center gap-2 mb-6">
      <Link 
        href={to}
        className="flex items-center text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300"
      >
        <BackArrowIcon className="mr-1" />
        <span suppressHydrationWarning={true}>
          {label || t('settings.backToDashboard')}
        </span>
      </Link>
    </div>
  );
};

export default BackLink; 