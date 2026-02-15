'use client';

import React from 'react';
import { useTranslation } from 'react-i18next';

import '@locales/i18n';
import TreeNode from './TreeNode';

import type { ExegeticalPlanNode } from '@/models/models';

interface TreeBuilderProps {
  tree: ExegeticalPlanNode[];
  draftTitles: Record<string, string>;
  focusedId: string | null;
  expand: Record<string, boolean>;
  hasUnsavedChanges: boolean;
  saving: boolean;
  onTitleChange: (id: string, value: string) => void;
  onFocus: (id: string) => void;
  onBlur: (id: string) => void;
  onRemove: (id: string) => void;
  onAddChild: (id: string) => void;
  onAddSibling: (id: string) => void;
  onPromote: (id: string) => void;
  onDemote: (id: string) => void;
  onAddMainPoint: () => void;
  onSave: () => void;
  autoSaveEnabled: boolean;
  onToggleAutoSave: () => void;
}

const TreeBuilder: React.FC<TreeBuilderProps> = ({
  tree,
  draftTitles,
  focusedId,
  expand,
  hasUnsavedChanges,
  saving,
  onTitleChange,
  onFocus,
  onBlur,
  onRemove,
  onAddChild,
  onAddSibling,
  onPromote,
  onDemote,
  onAddMainPoint,
  onSave,
  autoSaveEnabled,
  onToggleAutoSave
}) => {
  const { t } = useTranslation();

  return (
    <div className="space-y-2.5">
      <div className="flex items-center justify-between">
        <h5 className="text-xs font-medium text-gray-600 dark:text-gray-400 uppercase tracking-wide">
          {t('wizard.steps.exegeticalPlan.builder.title')}
        </h5>
        <div className="flex items-center gap-4">
          <label className="flex items-center gap-2 cursor-pointer group">
            <div className={`w-8 h-4 rounded-full relative transition-colors ${autoSaveEnabled ? 'bg-green-500' : 'bg-gray-300 dark:bg-gray-700'}`}>
              <div className={`absolute top-0.5 left-0.5 w-3 h-3 bg-white rounded-full transition-transform ${autoSaveEnabled ? 'translate-x-4' : 'translate-x-0'}`} />
            </div>
            <input
              type="checkbox"
              className="sr-only"
              checked={autoSaveEnabled}
              onChange={onToggleAutoSave}
            />
            <span className="text-[10px] font-medium text-gray-400 group-hover:text-gray-600 dark:group-hover:text-gray-300 transition-colors uppercase tracking-tight">
              {t('wizard.steps.exegeticalPlan.builder.autoSave')}
            </span>
          </label>

          {(tree && tree.length > 0) && (
            <button
              onClick={onSave}
              disabled={!!saving || !hasUnsavedChanges}
              className={`px-2.5 py-1 text-xs font-medium rounded transition-colors ${hasUnsavedChanges
                ? 'bg-blue-600 hover:bg-blue-700 text-white'
                : 'bg-gray-100 dark:bg-gray-800 text-gray-400 dark:text-gray-500 cursor-not-allowed'
                }`}
            >
              {saving ? t('buttons.saving') : t('buttons.save')}
            </button>
          )}
        </div>
      </div>

      {(!tree || tree.length === 0) ? (
        <div className="text-center py-6">
          <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
            {t('wizard.steps.exegeticalPlan.builder.empty')}
          </p>
          <button
            onClick={onAddMainPoint}
            title={t('wizard.steps.exegeticalPlan.builder.tooltips.addMain') as string}
            className="px-3 py-1.5 text-xs font-medium bg-blue-600 hover:bg-blue-700 text-white rounded-md transition-colors"
          >
            {t('wizard.steps.exegeticalPlan.builder.addMainPoint')}
          </button>
        </div>
      ) : (
        <div className="space-y-1">
          {tree.map((node, index) => {
            const isLast = index === tree.length - 1;
            return (
              <div key={node.id} className="relative">
                {/* Vertical line connecting root siblings (not after last) */}
                {!isLast && (
                  <div className="absolute left-0 top-10 bottom-[-4px] w-px bg-blue-400 dark:bg-blue-500" />
                )}
                <TreeNode
                  node={node}
                  index={index}
                  draftTitles={draftTitles}
                  focusedId={focusedId}
                  onTitleChange={onTitleChange}
                  onFocus={onFocus}
                  onBlur={onBlur}
                  onRemove={onRemove}
                  onAddChild={onAddChild}
                  onAddSibling={onAddSibling}
                  onPromote={onPromote}
                  onDemote={onDemote}
                  expand={expand}
                />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default TreeBuilder;
