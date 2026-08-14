'use client';

import { CheckIcon, ChevronDownIcon, PencilIcon, PlusIcon, TrashIcon, XMarkIcon } from '@heroicons/react/24/outline';
import { User } from 'firebase/auth';
import React, { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import OutlineBoard from '@/components/plan-editor/OutlineBoard';
import { SaveConflictBanner } from '@/components/SaveConflictBanner';
import ConfirmModal from '@/components/ui/ConfirmModal';
import { usePersistedConflict } from '@/hooks/usePersistedConflict';
import { usePlanTemplates } from '@/hooks/usePlanTemplates';
import { isStaleWriteError } from '@/services/conflictSafeUpdate.client';
import { PLAN_TEMPLATE_AGGREGATE } from '@/services/planTemplates.client';
import { newClientId } from '@/utils/clientId';
import { findDraftDocIds } from '@/utils/durableDraft';
import { awaitAcceptance } from '@/utils/recoverableWrite';

import type { PlanTemplate, SermonOutline } from '@/models/models';

interface PlanTemplatesSectionProps {
  user: User | null;
}

const emptyOutline = (): SermonOutline => ({ introduction: [], main: [], conclusion: [] });

const countPoints = (outline?: SermonOutline): number =>
  (outline?.introduction?.length ?? 0) + (outline?.main?.length ?? 0) + (outline?.conclusion?.length ?? 0);

const PlanTemplatesSection: React.FC<PlanTemplatesSectionProps> = ({ user }) => {
  const { t } = useTranslation();
  const { templates, loading, createTemplate, updateTemplate, deleteTemplate, refresh } =
    usePlanTemplates(user?.uid);


  /**
   * Which template the pending conflict belongs to.
   *
   * Per TEMPLATE, not one shared slot: two refused edits would otherwise overwrite
   * each other. Discovered on mount, because after a reload this screen has no
   * idea which template a stored refusal came from — a key nobody can find again
   * is the same as no key at all.
   */
  const [conflictTemplateId, setConflictTemplateId] = useState<string | null>(() =>
    user?.uid ? (findDraftDocIds(user.uid, `conflict:${PLAN_TEMPLATE_AGGREGATE}`)[0] ?? null) : null
  );

  /**
   * A refused template edit, held so it can be re-offered.
   *
   * Adversarial review was right that a toast alone loses it: `renamingId` is
   * cleared before the request, so the input is already closed when the refusal
   * arrives, and a structure edit lives only in `draftStructure` memory. The
   * conflict is persisted, so a reload does not cost the person their work.
   */
  const [conflict, setConflict] = usePersistedConflict<{
    templateId: string;
    label: string;
    updates: { name?: string; structure?: SermonOutline };
  }>(user?.uid, conflictTemplateId, PLAN_TEMPLATE_AGGREGATE);
  const [resolvingConflict, setResolvingConflict] = useState(false);

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
      await awaitAcceptance(
        createTemplate({ id: newClientId(), userId: user.uid, name, structure: emptyOutline() }),
        // usePlanTemplates' create recovery descriptor reports a late refusal while this screen is mounted.
        () => undefined
      );
      setNewName('');
    } catch (err) {
      /**
       * NO message here. `usePlanTemplates` declares a recovery descriptor for this
       * write, and it reports the same refusal — with the template name and a copy
       * action, from wherever the person has navigated to. Announcing here as well
       * showed one refused action as two failures.
       */
      console.error('Error creating plan template:', err);
    }
  };

  /**
   * A stale revision is a CHOICE, not a failure — and it can arrive on either path.
   *
   * A template write is owned by the durable queue, so acceptance resolves a tick after
   * launch and the transaction's verdict lands LATER, in the late-failure callback. That
   * callback used to be a no-op here, so the conflict never reached this screen: the
   * person got a generic refusal instead of "keep mine / take theirs", and a rename or
   * a whole edited structure could leave the editor. Both paths now hand the same
   * conflict to the same place.
   *
   * Returns true when it took ownership of the error.
   */
  const offerConflictChoice = (
    tpl: PlanTemplate,
    error: unknown,
    updates: { name?: string; structure?: SermonOutline },
    label: string
  ): boolean => {
    if (!isStaleWriteError(error)) return false;
    setConflictTemplateId(tpl.id);
    // Pass the id explicitly: the state above is not committed yet, so the key would
    // otherwise be built from the PREVIOUS value.
    setConflict(
      { payload: { templateId: tpl.id, label, updates }, actualRevision: error.actualRevision },
      tpl.id
    );
    toast.error(t('freshness.staleSaveToast'));
    return true;
  };

  const handleRename = async (tpl: PlanTemplate) => {
    const name = renameText.trim();
    setRenamingId(null);
    if (!name || name === tpl.name) return;
    try {
      // State the revision this edit was built from, so a rename from a tab that
      // never saw another device's change is refused rather than replacing it.
      await awaitAcceptance(
        updateTemplate(tpl.id, { name }, tpl.rev?.[PLAN_TEMPLATE_AGGREGATE] ?? 0),
        // The queue accepts first and the transaction answers later, so a conflict
        // arrives HERE — the rename input is already closed, and its typed name would
        // otherwise be gone.
        (err) => offerConflictChoice(tpl, err, { name }, name)
      );
    } catch (err) {
      if (offerConflictChoice(tpl, err, { name }, name)) return;
      // Reported by the update descriptor — see the note above. The stale-revision
      // branch above is different: it hands over a CHOICE, not a failure message.
      console.error('Error renaming plan template:', err);
    }
  };

  const confirmDelete = async () => {
    const tpl = pendingDeleteTpl;
    if (!tpl) return;
    setPendingDeleteTpl(null);
    try {
      // usePlanTemplates' delete recovery descriptor reports a late refusal while this screen is mounted.
      await awaitAcceptance(deleteTemplate(tpl.id), () => undefined);
      if (expandedId === tpl.id) {
        setExpandedId(null);
        setDraftStructure(null);
      }
    } catch (err) {
      // Reported by the delete descriptor — see the note above.
      console.error('Error deleting plan template:', err);
    }
  };

  // Debounced structure save while editing a template's outline inline.
  const handleStructureChange = (tpl: PlanTemplate, structure: SermonOutline) => {
    // Reflect the edit instantly (the board reads `value`), then persist on a debounce.
    setDraftStructure(structure);
    if (saveTimers.current[tpl.id]) clearTimeout(saveTimers.current[tpl.id]);
    saveTimers.current[tpl.id] = setTimeout(() => {
      const submission = updateTemplate(
        tpl.id,
        { structure },
        tpl.rev?.[PLAN_TEMPLATE_AGGREGATE] ?? 0
      );
      // The board still shows `draftStructure`, but only in memory — a reload would
      // take it. A conflict on EITHER path must therefore reach the same offer.
      void awaitAcceptance(submission, (err) =>
        offerConflictChoice(tpl, err, { structure }, tpl.name)
      ).catch((err) => {
        if (offerConflictChoice(tpl, err, { structure }, tpl.name)) return;
        // Reported by the template update descriptor — see the note in handleRename.
        console.error('Error saving template structure:', err);
      });
    }, 400);
  };

  /**
   * Show the NEXT stored refusal, if any.
   *
   * Discovery only runs on mount, so resolving one conflict used to leave a second
   * one invisible in storage until a reload — and it would then resurface days
   * later with no explanation of where it came from.
   */
  const advanceToNextStoredConflict = () => {
    if (!user?.uid) return;
    const next = findDraftDocIds(user.uid, `conflict:${PLAN_TEMPLATE_AGGREGATE}`).find(
      (id) => id !== conflictTemplateId
    );
    setConflictTemplateId(next ?? null);
  };

  const handleKeepMine = async () => {
    if (!conflict || resolvingConflict) return;
    setResolvingConflict(true);
    /**
     * Refused AGAIN — the template moved on between the first refusal and this click.
     * Re-aim at what the server holds NOW: pressing the button again would otherwise
     * resend the same outdated number forever. Used for BOTH timings, because a resend
     * can be refused before acceptance or long after it, and the late one had nobody at
     * all: this screen passed an empty callback, and the update descriptor deliberately
     * ignores stale errors (they are a choice, not a message). The person's rename — or
     * a whole plan structure — was left with no banner, no message and no way to copy it.
     */
    const refusedAgain = (error: unknown) => {
      if (!isStaleWriteError(error)) return false;
      setConflict(
        { payload: conflict.payload, actualRevision: error.actualRevision },
        conflict.payload.templateId
      );
      toast.error(t('freshness.staleSaveToast'));
      return true;
    };
    try {
      // Adopt the revision the server held AT REFUSAL — a deliberate overwrite.
      await awaitAcceptance(
        updateTemplate(conflict.payload.templateId, conflict.payload.updates, conflict.actualRevision),
        refusedAgain
      );
      // NAME the template this resolves: the slot is per template, and an unnamed
      // clear would empty whichever one the section is pointing at right now.
      setConflict(null, conflict.payload.templateId);
      advanceToNextStoredConflict();
    } catch (err) {
      if (refusedAgain(err)) {
        // handled above — the choice is back on screen with the newer revision
      } else {
        // Reported by the template update descriptor — see the note in handleRename.
        console.error('Error re-sending the refused template edit:', err);
      }
    } finally {
      setResolvingConflict(false);
    }
  };

  const handleTakeTheirs = async () => {
    if (!conflict || resolvingConflict) return;
    setResolvingConflict(true);
    try {
      const result = await refresh();
      // `refetch()` resolves an error result instead of throwing; clearing the
      // conflict then would discard the only copy without loading theirs.
      if ((result as { isError?: boolean })?.isError) {
        toast.error(t('planTemplates.saveStructureError'));
        return;
      }
      setDraftStructure(null);
      setConflict(null, conflict.payload.templateId);
      advanceToNextStoredConflict();
    } finally {
      setResolvingConflict(false);
    }
  };

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-4 md:p-6">
      <h2 className="text-lg md:text-xl font-semibold mb-2">
        <span suppressHydrationWarning={true}>{t('settings.planTemplates')}</span>
      </h2>
      <p className="text-sm text-gray-500 dark:text-gray-400 mb-4 md:mb-6">{t('planTemplates.description')}</p>

      {/* A save was TURNED AWAY. The rename input has already closed and the
          structure lives only in memory, so this panel holds the refused edit. */}
      {conflict && (
        <SaveConflictBanner
          entityKey="entityRecord"
          pendingText={conflict.payload.updates.name ?? conflict.payload.label}
          onKeepMine={handleKeepMine}
          onTakeTheirs={handleTakeTheirs}
          busy={resolvingConflict}
          className="mb-4"
        />
      )}

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
