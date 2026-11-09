'use client';

import { CheckIcon, ChevronDownIcon, PencilIcon, PlusIcon, TrashIcon, XMarkIcon } from '@heroicons/react/24/outline';
import { User } from 'firebase/auth';
import React, { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';

import { SaveConflictBanner } from '@/components/SaveConflictBanner';
import TemplateOutlineEditor, { type TemplateOutlineEditorHandle } from '@/components/settings/TemplateOutlineEditor';
import ConfirmModal from '@/components/ui/ConfirmModal';
import { DocumentFieldHistory } from '@/components/ui/DocumentFieldHistory';
import UnreadableConflictDrafts from '@/components/UnreadableConflictDrafts';
import { useDiscardQuestion } from '@/hooks/useConfirm';
import { usePersistedConflict } from '@/hooks/usePersistedConflict';
import { usePlanTemplates } from '@/hooks/usePlanTemplates';
import { isStaleWriteError } from '@/services/conflictSafeUpdate.client';
import { PLAN_TEMPLATE_AGGREGATE } from '@/services/planTemplates.client';
import { newClientId } from '@/utils/clientId';
import { awaitWriteOperation } from '@/utils/recoverableWrite';
import { validTemplateConflict } from '@/utils/refusedDraftPayloads';
import { NEUTRAL_CAPTION } from '@/utils/themeColors';
import { useTranslation } from '@locales/useTranslation';

import type { DocumentTitleSeen } from '@/data-engine/documentFieldAction';
import type { PlanTemplate, SermonOutline } from '@/models/models';

interface PlanTemplatesSectionProps {
  user: User | null;
  requestedTemplateId?: string | null;
}

type TemplateNameOpening = { id: string; owner: string; name: string; revision: number; seen?: DocumentTitleSeen };

const STRUCTURE_SAVE_ERROR = 'planTemplates.saveStructureError';

const emptyOutline = (): SermonOutline => ({ introduction: [], main: [], conclusion: [] });

const countPoints = (outline?: SermonOutline): number =>
  (outline?.introduction?.length ?? 0) + (outline?.main?.length ?? 0) + (outline?.conclusion?.length ?? 0);

const PlanTemplatesSection: React.FC<PlanTemplatesSectionProps> = ({ user, requestedTemplateId }) => {
  const { t } = useTranslation();
  const { templates, loading, createTemplate, updateTemplate, deleteTemplate, refresh, observeName, captureActionTime } =
    usePlanTemplates(user?.uid);


  /**
   * Which template the pending conflict belongs to.
   *
   * Per TEMPLATE, not one shared slot: two refused edits would otherwise overwrite
   * each other. Discovered on mount, because after a reload this screen has no
   * idea which template a stored refusal came from — a key nobody can find again
   * is the same as no key at all.
   */
  const [conflictTemplateId, setConflictTemplateId] = useState<string | null>(null);

  /**
   * A refused template edit, held so it can be re-offered.
   *
   * A stale edit hands its exact name or structure to this persisted choice.
   * The choice remains discoverable after the original editor closes or reloads.
   */
  const [conflict, setConflict, , conflictChoices] = usePersistedConflict<{
    templateId: string;
    label: string;
    updates: { name?: string; structure?: SermonOutline };
  }>(user?.uid, conflictTemplateId, PLAN_TEMPLATE_AGGREGATE, validTemplateConflict);
  const findNextConflictDocument = conflictChoices.nextDocument;
  useEffect(() => { setConflictTemplateId(user?.uid ? findNextConflictDocument() : null); }, [user?.uid, findNextConflictDocument]);
  const [resolvingConflict, setResolvingConflict] = useState(false);

  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);
  const creatingRef = useRef(false);
  const [renaming, setRenaming] = useState<TemplateNameOpening | null>(null);
  const [renameText, setRenameText] = useState('');
  const [renamingPending, setRenamingPending] = useState(false);
  const renamingPendingRef = useRef(false);
  const [expanded, setExpanded] = useState<{ owner: string; id: string } | null>(null);
  const expandedId = expanded?.owner === user?.uid ? expanded?.id ?? null : null;
  const expandedIdRef = useRef(expandedId);
  expandedIdRef.current = expandedId;
  const inlineEditor = useRef<TemplateOutlineEditorHandle | null>(null);
  const transition = useRef<{ owner: string; token: object } | null>(null);
  const [transitionOwner, setTransitionOwner] = useState<string | null>(null);
  const transitioning = Boolean(user?.uid && transitionOwner === user.uid);
  const [pendingDeleteTpl, setPendingDeleteTpl] = useState<PlanTemplate | null>(null);
  const [deleting, setDeleting] = useState(false);
  const deletingRef = useRef(false);
  const { askBeforeDiscard, discardDialog, withdraw } = useDiscardQuestion('text');
  const conflictRef = useRef(conflict);
  conflictRef.current = conflict;
  const conflictTemplateIdRef = useRef(conflictTemplateId);
  conflictTemplateIdRef.current = conflictTemplateId;
  const userIdRef = useRef(user?.uid ?? null);
  userIdRef.current = user?.uid ?? null;

  useEffect(() => { withdraw(); }, [user?.uid, conflictTemplateId, withdraw]);

  // These temporary actions belong to the identity that opened them. Capture
  // remains locked until its own promise settles; no new owner can replay them.
  useEffect(() => {
    setRenaming(null);
    setRenameText('');
    setPendingDeleteTpl(null);
  }, [user?.uid]);


  const selectTemplate = async (nextId: string | null) => {
    const owner = userIdRef.current;
    if (!owner || transition.current?.owner === owner || deletingRef.current) return;
    const currentId = expandedIdRef.current, editor = inlineEditor.current;
    if (currentId === nextId) return;
    const token = {};
    transition.current = { owner, token };
    setTransitionOwner(owner);
    try {
      if (currentId && editor) await editor.capture();
      if (userIdRef.current === owner && expandedIdRef.current === currentId && inlineEditor.current === editor) {
        setExpanded(nextId ? { owner, id: nextId } : null);
      }
    } catch {
      // The canonical document says why capture failed. Its board stays open.
    } finally {
      if (transition.current?.token === token) {
        transition.current = null;
        setTransitionOwner(null);
      }
    }
  };
  const selectTemplateRef = useRef(selectTemplate);
  selectTemplateRef.current = selectTemplate;
  const openedRequest = useRef<string | null>(null);
  useEffect(() => {
    if (!user?.uid || !requestedTemplateId || !templates.some(tpl => tpl.id === requestedTemplateId)) return;
    const request = JSON.stringify([user.uid, requestedTemplateId]);
    if (openedRequest.current === request) return;
    openedRequest.current = request;
    void selectTemplateRef.current(requestedTemplateId);
  }, [user?.uid, requestedTemplateId, templates]);

  const handleCreate = async () => {
    const submittedName = newName;
    const name = submittedName.trim();
    const ownerId = user?.uid;
    if (!name || !ownerId || creatingRef.current) return;
    creatingRef.current = true;
    setCreating(true);
    const reportFailure = (error: unknown) => {
      console.error('Error creating plan template:', error);
      if (userIdRef.current === ownerId) toast.error(t('planTemplates.createError'));
    };
    try {
      await awaitWriteOperation(
        createTemplate({ id: newClientId(), userId: ownerId, name, structure: emptyOutline() }),
        reportFailure
      );
      if (userIdRef.current === ownerId) setNewName(current => current === submittedName ? '' : current);
    } catch (error) {
      reportFailure(error);
    } finally {
      creatingRef.current = false;
      setCreating(false);
    }
  };

  /** A stale revision offers the same persisted choice for public and legacy writers. */
  const offerConflictChoice = (
    tpl: PlanTemplate,
    error: unknown,
    updates: { name?: string; structure?: SermonOutline },
    label: string,
    selectedAtStart: { id: string | null; record: typeof conflict }
  ): boolean => {
    if (!isStaleWriteError(error)) return false;
    const unchanged = conflictTemplateIdRef.current === selectedAtStart.id && conflictRef.current === selectedAtStart.record;
    if (unchanged || !conflictTemplateIdRef.current) setConflictTemplateId(tpl.id);
    // Pass the id explicitly: the state above is not committed yet, so the key would
    // otherwise be built from the PREVIOUS value.
    setConflict(
      { payload: { templateId: tpl.id, label, updates }, actualRevision: error.actualRevision },
      tpl.id
    );
    toast.error(t('freshness.staleSaveToast'));
    return true;
  };

  const submitName = (opening: TemplateNameOpening, name: string) => {
    if (opening.owner !== userIdRef.current) return Promise.reject(new Error('The template editor changed'));
    const seen = opening.seen;
    return seen
      ? updateTemplate(opening.id, { name }, opening.revision, { seen, time: captureActionTime?.() ?? null })
      : updateTemplate(opening.id, { name }, opening.revision);
  };

  const handleRename = async (tpl: PlanTemplate) => {
    const ownerId = user?.uid;
    const opening = renaming;
    if (!ownerId || !opening || opening.owner !== ownerId || opening.id !== tpl.id || renamingPendingRef.current) return;
    const selectedAtStart = { id: conflictTemplateIdRef.current, record: conflictRef.current };
    const name = renameText.trim();
    if (!name || name === opening.name) { setRenaming(null); return; }
    renamingPendingRef.current = true;
    setRenamingPending(true);
    const reportFailure = (error: unknown) => {
      if (userIdRef.current !== ownerId) return;
      if (offerConflictChoice(tpl, error, { name }, name, selectedAtStart)) {
        setRenaming(current => current === opening ? null : current);
        return;
      }
      console.error('Error renaming plan template:', error);
      toast.error(t('planTemplates.renameError'));
    };
    try {
      await awaitWriteOperation(
        submitName(opening, name),
        reportFailure
      );
      if (userIdRef.current === ownerId) setRenaming(current => current === opening ? null : current);
    } catch (error) {
      reportFailure(error);
    } finally {
      renamingPendingRef.current = false;
      setRenamingPending(false);
    }
  };

  const confirmDelete = async () => {
    const tpl = pendingDeleteTpl, ownerId = user?.uid;
    if (!tpl || !ownerId || deletingRef.current) return;
    deletingRef.current = true;
    setDeleting(true);
    const reportFailure = (error: unknown) => {
      if (userIdRef.current !== ownerId) return;
      console.error('Error deleting plan template:', error);
      toast.error(t('planTemplates.deleteError'));
    };
    try {
      const editor = expandedIdRef.current === tpl.id ? inlineEditor.current : null;
      await awaitWriteOperation(editor ? editor.remove() : deleteTemplate(tpl.id), reportFailure);
      if (userIdRef.current !== ownerId) return;
      setPendingDeleteTpl(current => current?.id === tpl.id ? null : current);
      if (expandedId === tpl.id) {
        setExpanded(null);
      }
    } catch (error) {
      reportFailure(error);
    } finally {
      deletingRef.current = false;
      setDeleting(false);
    }
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
    setConflictTemplateId(conflictChoices.nextDocument(conflictTemplateId));
  };

  const handleKeepMine = async () => {
    if (!conflict || resolvingConflict) return;
    setResolvingConflict(true);
    const ownerId = user?.uid;
    const reportFailure = (error: unknown) => {
      if (userIdRef.current !== ownerId) return;
      if (isStaleWriteError(error)) {
        setConflictTemplateId(current => current ?? conflict.payload.templateId);
        setConflict(
          { payload: conflict.payload, actualRevision: error.actualRevision },
          conflict.payload.templateId,
          conflict
        );
        toast.error(t('freshness.staleSaveToast'));
        return;
      }
      console.error('Error re-sending the refused template edit:', error);
      toast.error(t(STRUCTURE_SAVE_ERROR));
    };
    try {
      // Adopt the revision the server held AT REFUSAL — a deliberate overwrite.
      await awaitWriteOperation(
        updateTemplate(conflict.payload.templateId, conflict.payload.updates, conflict.actualRevision),
        reportFailure
      );
      if (userIdRef.current !== ownerId) return;
      // NAME the template this resolves: the slot is per template, and an unnamed
      // clear would empty whichever one the section is pointing at right now.
      setConflict(null, conflict.payload.templateId, conflict);
      advanceToNextStoredConflict();
    } catch (error) {
      reportFailure(error);
    } finally {
      setResolvingConflict(false);
    }
  };

  const handleTakeTheirs = async () => {
    const heldConflict = conflictRef.current;
    if (!heldConflict || resolvingConflict) return;
    const capturedOwnerId = userIdRef.current;
    const capturedTemplateId = heldConflict.payload.templateId;
    const discardsStructure = Boolean(heldConflict.payload.updates.structure);
    const capturedEditor = inlineEditor.current;
    const capturedDraftSnapshot = capturedEditor?.snapshot();
    const isCurrent = () => userIdRef.current === capturedOwnerId &&
      conflictTemplateIdRef.current === capturedTemplateId &&
      conflictRef.current === heldConflict &&
      (!discardsStructure || (inlineEditor.current === capturedEditor && capturedEditor?.snapshot() === capturedDraftSnapshot));
    setResolvingConflict(true);
    try {
      await askBeforeDiscard(true, async () => {
        if (!isCurrent()) return;
        let result: unknown;
        try {
          result = await refresh();
        } catch {
          toast.error(t(STRUCTURE_SAVE_ERROR));
          return;
        }
        // `refetch()` resolves an error result instead of throwing; clearing the
        // conflict then would discard the only copy without loading theirs.
        if ((result as { isError?: boolean })?.isError) {
          toast.error(t(STRUCTURE_SAVE_ERROR));
          return;
        }
        // A second conflict or a new draft can arrive while refresh is in flight.
        // The old answer may retire only the exact copy it asked about.
        if (!isCurrent()) return;
        // This retires only the legacy copy; canonical editor words keep their own lifetime.
        setConflict(null, capturedTemplateId, heldConflict);
        advanceToNextStoredConflict();
      }, isCurrent);
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
      {discardDialog}

      <UnreadableConflictDrafts owner={user?.uid} sources={conflictChoices.unreadableSources} failed={conflictChoices.unreadableFailed} />
      {/* Saved legacy choices remain discoverable independently of the canonical editor. */}
      {conflict && (
        <SaveConflictBanner
          entityKey="entityRecord"
          pendingText={conflict.payload.updates.name ?? conflict.payload.label}
          copyOptions={conflictChoices.copies.map(copy => ({ key: copy.key, label: copy.value.payload.updates.name ?? copy.value.payload.label }))}
          selectedCopyKey={conflictChoices.selectedKey}
          onChooseCopy={conflictChoices.select}
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
          disabled={creating || !newName.trim()}
          aria-busy={creating}
          className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium px-3 py-2 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <PlusIcon className="h-4 w-4" />
          {t('planTemplates.create')}
        </button>
      </div>

      {loading ? (
        <p className={`text-sm ${NEUTRAL_CAPTION}`}>{t('settings.loading')}</p>
      ) : templates.length === 0 ? (
        <p className={`text-sm ${NEUTRAL_CAPTION}`}>{t('planTemplates.empty')}</p>
      ) : (
        <ul className="space-y-2">
          {templates.map((tpl) => {
            const isExpanded = expandedId === tpl.id;
            const seen = observeName?.(tpl.id, tpl.name);
            const opening = user?.uid ? { id: tpl.id, owner: user.uid, name: tpl.name,
              revision: tpl.rev?.[PLAN_TEMPLATE_AGGREGATE] ?? 0, seen } : null;
            return (
              <li key={tpl.id} className="rounded-lg border border-gray-200 dark:border-gray-700">
                <div className="flex items-center gap-2 p-3">
                  <button
                    onClick={() => { void selectTemplate(isExpanded ? null : tpl.id); }}
                    disabled={transitioning || deleting}
                    className="p-1 rounded hover:bg-black/5 dark:hover:bg-white/10 text-gray-500 dark:text-gray-400"
                    aria-label={isExpanded ? t('common.collapse') : t('common.expand')}
                  >
                    <ChevronDownIcon className={`h-4 w-4 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                  </button>

                  {renaming?.id === tpl.id && renaming.owner === user?.uid ? (
                    <div className="flex-1 flex items-center gap-1">
                      <input
                        type="text"
                        value={renameText}
                        disabled={renamingPending || transitioning || deleting}
                        onChange={(e) => setRenameText(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') handleRename(tpl);
                          if (e.key === 'Escape' && !renamingPendingRef.current) setRenaming(null);
                        }}
                        className="flex-1 p-1.5 text-sm bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-200 rounded border border-gray-300 dark:border-gray-600 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                        autoFocus
                      />
                      <button aria-label={t('common.save')} disabled={renamingPending || transitioning || deleting} aria-busy={renamingPending} onClick={() => handleRename(tpl)} className="p-1 text-green-600 hover:text-green-800">
                        <CheckIcon className="h-5 w-5" />
                      </button>
                      <button aria-label={t('common.cancel')} disabled={renamingPending || transitioning || deleting} onClick={() => { if (!renamingPendingRef.current) setRenaming(null); }} className="p-1 text-red-600 hover:text-red-800">
                        <XMarkIcon className="h-5 w-5" />
                      </button>
                    </div>
                  ) : (
                    <>
                      <span className="flex-1 text-sm font-medium text-gray-800 dark:text-gray-200 truncate">{tpl.name}</span>
                      <span className={`text-xs ${NEUTRAL_CAPTION} tabular-nums`}>
                        {countPoints(tpl.structure)} {t('planTemplates.pointsLabel', { count: countPoints(tpl.structure) })}
                      </span>
                      <button
                        aria-label={t('common.edit')}
                        disabled={renamingPending || transitioning || deleting}
                        onClick={() => {
                          setRenaming(opening);
                          setRenameText(tpl.name);
                        }}
                        className="p-1 text-gray-400 hover:text-indigo-600 dark:hover:text-indigo-400"
                      >
                        <PencilIcon className="h-4 w-4" />
                      </button>
                      <button
                        aria-label={t('common.delete')}
                        disabled={renamingPending || transitioning || deleting}
                        onClick={() => setPendingDeleteTpl(tpl)}
                        className="p-1 text-gray-400 hover:text-red-600 dark:hover:text-red-400"
                      >
                        <TrashIcon className="h-4 w-4" />
                      </button>
                    </>
                  )}
                </div>

                {opening && seen && <div className="px-3 pb-2 empty:hidden">
                  <DocumentFieldHistory key={JSON.stringify([opening.owner, tpl.id, seen.generation])}
                    current={tpl.name} disabled={Boolean(seen.requestId || renaming || renamingPending || transitioning || deleting)}
                    session={{ owner: opening.owner, templateId: tpl.id, generation: seen.generation,
                      restore: (value: string) => submitName(opening, value) }} />
                </div>}
                {isExpanded && (
                  <div className="border-t border-gray-200 dark:border-gray-700 p-3">
                    <TemplateOutlineEditor key={`${user?.uid}:${tpl.id}`} ref={inlineEditor}
                      templateId={tpl.id} disabled={transitioning || deleting} />
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <ConfirmModal
        isOpen={!!pendingDeleteTpl}
        onClose={() => { if (!deletingRef.current) setPendingDeleteTpl(null); }}
        isDeleting={deleting}
        onConfirm={confirmDelete}
        title={t('planTemplates.deleteConfirm', { name: pendingDeleteTpl?.name ?? '' })}
        confirmText={t('common.delete')}
        isDestructive
      />
    </div>
  );
};

export default PlanTemplatesSection;
