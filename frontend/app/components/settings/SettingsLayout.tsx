'use client';

import React, { ReactNode } from 'react';

import BackLink from './BackLink';

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

  
  return (
    <div className="py-4 md:py-6">
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
  );
};

export default SettingsLayout; 