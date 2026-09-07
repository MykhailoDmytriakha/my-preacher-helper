'use client';

import { ListTree, HelpCircle } from 'lucide-react';
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';

import '@locales/i18n';
import { Chip } from '@/components/ui/Chip';

const BlockDiagramSection: React.FC = () => {
  const { t } = useTranslation();
  const [showInfo, setShowInfo] = useState(false);

  return (
    <div className="p-2.5 rounded-md bg-amber-50 dark:bg-amber-900/10 border border-amber-200 dark:border-amber-800">
      <div className="flex items-center gap-1.5">
        <ListTree className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" />
        <h4 className="text-xs font-medium text-gray-600 dark:text-gray-400 uppercase tracking-wide">
          {t('wizard.steps.exegeticalPlan.blockDiagram.title')}
        </h4>
        <Chip tone="amber" size="xs">
          {t('wizard.steps.exegeticalPlan.blockDiagram.comingSoon')}
        </Chip>
        <button
          type="button"
          onClick={() => setShowInfo(!showInfo)}
          className="ml-auto text-amber-600 hover:text-amber-700 dark:text-amber-400 dark:hover:text-amber-300 transition-colors"
          title={t('wizard.steps.exegeticalPlan.blockDiagram.notAvailableYet') as string}
        >
          <HelpCircle className="w-3.5 h-3.5" />
        </button>
      </div>
      
      <p className="text-xs text-gray-500 dark:text-gray-400 mt-1.5">
        {t('wizard.steps.exegeticalPlan.blockDiagram.description')}
      </p>
      
      {showInfo && (
        <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-2 pt-2 border-t border-amber-200 dark:border-amber-800">
          {t('wizard.steps.exegeticalPlan.blockDiagram.notAvailableYet')}
        </p>
      )}
    </div>
  );
};

export default BlockDiagramSection;
