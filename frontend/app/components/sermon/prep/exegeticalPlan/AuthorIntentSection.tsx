'use client';

import React from 'react';
import { Info, Check, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import '@locales/i18n';
import { UI_COLORS } from '@/utils/themeColors';
import type { AuthorIntentSectionProps } from './types';

const AuthorIntentSection: React.FC<AuthorIntentSectionProps> = ({
  value,
  onChange,
  onSave,
  isSaving,
  hasChanges
}) => {
  const { t } = useTranslation();

  const handleSave = async () => {
    if (!hasChanges || isSaving) return;
    await onSave();
  };

  const handleCancel = () => {
    onChange('');
  };

  return (
    <div>
      <div className="flex items-center gap-1.5 mb-2">
        <Info className="w-3.5 h-3.5 text-gray-500 dark:text-gray-400" />
        <h4 className="text-xs font-medium text-gray-600 dark:text-gray-400 uppercase tracking-wide">
          {t('wizard.steps.exegeticalPlan.authorIntent.title')}
        </h4>
      </div>
      
      <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">
        {t('wizard.steps.exegeticalPlan.authorIntent.description')}
      </p>
      
      <div className="relative">
        <textarea
          className="w-full text-sm rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-2.5 focus:outline-none focus:border-blue-500 dark:focus:border-blue-400 transition-colors placeholder-gray-400 dark:placeholder-gray-500 resize-none"
          rows={3}
          placeholder={t('wizard.steps.exegeticalPlan.authorIntent.placeholder') as string}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
        
        {hasChanges && (
          <div className="mt-1.5 flex items-center justify-end gap-1.5">
            <button
              type="button"
              onClick={handleCancel}
              className="px-2.5 py-1 text-xs text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200 transition-colors"
            >
              {t('actions.cancel') || 'Cancel'}
            </button>
            
            <button
              type="button"
              onClick={handleSave}
              disabled={isSaving}
              className="px-2.5 py-1 text-xs font-medium bg-blue-600 hover:bg-blue-700 text-white rounded transition-colors disabled:opacity-50"
              title={t('actions.save') || 'Save'}
            >
              {isSaving ? t('buttons.saving') : (t('actions.save') || 'Save')}
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default AuthorIntentSection;
