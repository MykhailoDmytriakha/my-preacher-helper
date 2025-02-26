'use client';

import React from 'react';
import Link from 'next/link';
import { useTranslation } from 'react-i18next';

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
        <svg 
          className="w-5 h-5 mr-1" 
          fill="none" 
          stroke="currentColor" 
          viewBox="0 0 24 24"
        >
          <path 
            strokeLinecap="round" 
            strokeLinejoin="round" 
            strokeWidth={2} 
            d="M10 19l-7-7m0 0l7-7m-7 7h18"
          />
        </svg>
        <span suppressHydrationWarning={true}>
          {label || t('settings.backToDashboard')}
        </span>
      </Link>
    </div>
  );
};

export default BackLink; 