'use client';

import React, { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import BackLink from './BackLink';
import DashboardNav from '@/components/navigation/DashboardNav';

interface SettingsLayoutProps {
  children: ReactNode;
  title?: string;
  showBackLink?: boolean;
}

const SettingsLayout: React.FC<SettingsLayoutProps> = ({ 
  children, 
  title,
  showBackLink = true
}) => {
  const { t } = useTranslation();
  
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <DashboardNav />
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 md:py-6">
        {showBackLink && <BackLink to="/dashboard" />}
        
        {title && (
          <h1 className="text-xl md:text-2xl font-bold mb-4 md:mb-8">
            <span suppressHydrationWarning={true}>{title}</span>
          </h1>
        )}
        
        <div className="space-y-4 md:space-y-8">
          {children}
        </div>
      </div>
    </div>
  );
};

export default SettingsLayout; 