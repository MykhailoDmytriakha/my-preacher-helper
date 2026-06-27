'use client';

import { CheckIcon, ChevronDownIcon, PencilIcon, PlusIcon, TrashIcon, XMarkIcon } from '@heroicons/react/24/outline';
import { User } from 'firebase/auth';
import React, { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import OutlineBoard from '@/components/plan-editor/OutlineBoard';
import ConfirmModal from '@/components/ui/ConfirmModal';
import { usePlanTemplates } from '@/hooks/usePlanTemplates';
import { newClientId } from '@/utils/clientId';

import type { PlanTemplate, SermonOutline } from '@/models/models';

interface PlanTemplatesSectionProps {
  user: User | null;
}

const emptyOutline = (): SermonOutline => ({ introduction: [], main: [], conclusion: [] });

const countPoints = (outline?: SermonOutline): number =>
  (outline?.introduction?.length ?? 0) + (outline?.main?.length ?? 0) + (outline?.conclusion?.length ?? 0);

const PlanTemplatesSection: React.FC<PlanTemplatesSectionProps> = ({ user }) => {
  const { t } = useTranslation();
  const { templates, loading, createTemplate, updateTemplate, deleteTemplate } = usePlanTemplates(user?.uid);

  const [newName, setNewName] = useState('');
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameText, setRenameText] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  // Local optimistic copy of the expanded template's structure. The OutlineBoard
  // is a controlled editor (renders straight from `value`); feeding it the React
  // Query cache directly meant a freshly added point only appeared after the
  // debounced save + refetch round-trip (~1s of "it vanished"). Buffering the
  // edit locally makes the point show on Enter; the save catches up in the
  // background. Mirrors how PlanEditorModal owns its own `outline` state.
  const [draftStructure, setDraftStructure] = useState<SermonOutline | null>(null);
  const [pendingDeleteTpl, setPendingDeleteTpl] = useState<PlanTemplate | null>(null);
  const saveTimers = useRef<Record<string, NodeJS.Timeout>>({});

  const toggleExpand = (tpl: PlanTemplate) => {
    if (expandedId === tpl.id) {
      setExpandedId(null);
      setDraftStructure(null);
    } else {
      setExpandedId(tpl.id);
      setDraftStructure(tpl.structure ?? emptyOutline());
    }
  };

  const handleCreate = async () => {
    const name = newName.trim();
    if (!name || !user?.uid) return;
    try {
      await createTemplate({ id: newClientId(), userId: user.uid, name, structure: emptyOutline() });
      setNewName('');
      toast.success(t('planTemplates.created'));
    } catch (err) {
      console.error('Error creating plan template:', err);
      toast.error(t('planTemplates.createError'));
    }
  };

  const handleRename = async (tpl: PlanTemplate) => {
    const name = renameText.trim();
    setRenamingId(null);
    if (!name || name === tpl.name) return;
    try {
      await updateTemplate(tpl.id, { name });
    } catch (err) {
      console.error('Error renaming plan template:', err);
      toast.error(t('planTemplates.renameError'));
    }
  };

  const confirmDelete = async () => {
    const tpl = pendingDeleteTpl;
    if (!tpl) return;
    setPendingDeleteTpl(null);
    try {
      await deleteTemplate(tpl.id);
      if (expandedId === tpl.id) {
        setExpandedId(null);
        setDraftStructure(null);
      }
    } catch (err) {
      console.error('Error deleting plan template:', err);
      toast.error(t('planTemplates.deleteError'));
    }
  };

  // Debounced structure save while editing a template's outline inline.
  const handleStructureChange = (tpl: PlanTemplate, structure: SermonOutline) => {
    // Reflect the edit instantly (the board reads `value`), then persist on a debounce.
    setDraftStructure(structure);
    if (saveTimers.current[tpl.id]) clearTimeout(saveTimers.current[tpl.id]);
    saveTimers.current[tpl.id] = setTimeout(() => {
      void updateTemplate(tpl.id, { structure }).catch((err) => {
        console.error('Error saving template structure:', err);
        toast.error(t('planTemplates.saveStructureError'));
      });
    }, 400);
  };

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-4 md:p-6">
      <h2 className="text-lg md:text-xl font-semibold mb-2">
        <span suppressHydrationWarning={true}>{t('settings.planTemplates')}</span>
      </h2>
      <p className="text-sm text-gray-500 dark:text-gray-400 mb-4 md:mb-6">{t('planTemplates.description')}</p>

      {/* Create new */}
      <div className="flex items-center gap-2 mb-6 max-w-xl">
        <input
          type="text"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleCreate();
          }}
          placeholder={t('planTemplates.createPlaceholder')}
          className="flex-1 p-2 text-sm bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-200 rounded border border-gray-300 dark:border-gray-600 focus:outline-none focus:ring-1 focus:ring-indigo-500"
        />
        <button
          onClick={handleCreate}
          disabled={!newName.trim()}
          className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium px-3 py-2 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <PlusIcon className="h-4 w-4" />
          {t('planTemplates.create')}
        </button>
      </div>

      {loading ? (
        <p className="text-sm text-gray-400">{t('settings.loading')}</p>
      ) : templates.length === 0 ? (
        <p className="text-sm text-gray-400 dark:text-gray-500">{t('planTemplates.empty')}</p>
      ) : (
        <ul className="space-y-2">
          {templates.map((tpl) => {
            const isExpanded = expandedId === tpl.id;
            return (
              <li key={tpl.id} className="rounded-lg border border-gray-200 dark:border-gray-700">
                <div className="flex items-center gap-2 p-3">
                  <button
                    onClick={() => toggleExpand(tpl)}
                    className="p-1 rounded hover:bg-black/5 dark:hover:bg-white/10 text-gray-500 dark:text-gray-400"
                    aria-label={isExpanded ? t('common.collapse') : t('common.expand')}
                  >
                    <ChevronDownIcon className={`h-4 w-4 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                  </button>

                  {renamingId === tpl.id ? (
                    <div className="flex-1 flex items-center gap-1">
                      <input
                        type="text"
                        value={renameText}
                        onChange={(e) => setRenameText(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') handleRename(tpl);
                          if (e.key === 'Escape') setRenamingId(null);
                        }}
                        className="flex-1 p-1.5 text-sm bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-200 rounded border border-gray-300 dark:border-gray-600 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                        autoFocus
                      />
                      <button aria-label={t('common.save')} onClick={() => handleRename(tpl)} className="p-1 text-green-600 hover:text-green-800">
                        <CheckIcon className="h-5 w-5" />
                      </button>
                      <button aria-label={t('common.cancel')} onClick={() => setRenamingId(null)} className="p-1 text-red-600 hover:text-red-800">
                        <XMarkIcon className="h-5 w-5" />
                      </button>
                    </div>
                  ) : (
                    <>
                      <span className="flex-1 text-sm font-medium text-gray-800 dark:text-gray-200 truncate">{tpl.name}</span>
                      <span className="text-xs text-gray-400 tabular-nums">
                        {countPoints(tpl.structure)} {t('planTemplates.pointsLabel')}
                      </span>
                      <button
                        aria-label={t('common.edit')}
                        onClick={() => {
                          setRenamingId(tpl.id);
                          setRenameText(tpl.name);
                        }}
                        className="p-1 text-gray-400 hover:text-indigo-600 dark:hover:text-indigo-400"
                      >
                        <PencilIcon className="h-4 w-4" />
                      </button>
                      <button
                        aria-label={t('common.delete')}
                        onClick={() => setPendingDeleteTpl(tpl)}
                        className="p-1 text-gray-400 hover:text-red-600 dark:hover:text-red-400"
                      >
                        <TrashIcon className="h-4 w-4" />
                      </button>
                    </>
                  )}
                </div>

                {isExpanded && (
                  <div className="border-t border-gray-200 dark:border-gray-700 p-3">
                    <OutlineBoard
                      value={draftStructure ?? tpl.structure ?? emptyOutline()}
                      onChange={(structure) => handleStructureChange(tpl, structure)}
                      className="grid grid-cols-1 md:grid-cols-3 gap-3"
                    />
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <ConfirmModal
        isOpen={!!pendingDeleteTpl}
        onClose={() => setPendingDeleteTpl(null)}
        onConfirm={confirmDelete}
        title={t('planTemplates.deleteConfirm', { name: pendingDeleteTpl?.name ?? '' })}
        confirmText={t('common.delete')}
        isDestructive
      />
    </div>
  );
};

export default PlanTemplatesSection;
