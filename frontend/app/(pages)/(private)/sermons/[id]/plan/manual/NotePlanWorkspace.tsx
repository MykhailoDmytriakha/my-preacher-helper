'use client';

import { ChevronRightIcon, LightBulbIcon } from '@heroicons/react/24/outline';
import { createContext, useContext, useEffect, useId, useMemo, useState, type ReactNode } from 'react';

import MarkdownDisplay from '@/components/MarkdownDisplay';
import PlanGenerationButton from '@/components/plan/PlanGenerationButton';
import PlanStyleSelector from '@/components/plan/PlanStyleSelector';
import { Button } from '@/components/ui/Button';
import { useAiUsage } from '@/hooks/useAiUsage';
import { useSourceNotes } from '@/hooks/useSermonNoteLinks';
import { notePlanSourceText } from '@/utils/notePlan';
import { SCRATCH_REMINDER_COLORS, SERMON_SECTION_COLORS } from '@/utils/themeColors';
import { useTranslation } from '@locales/useTranslation';

import { planNodesForPoint } from '../planNodes';

import NotePlanRefinement, { refinementPanelId } from './NotePlanRefinement';
import { useNotePlanGeneration } from './useNotePlanGeneration';

import type { SermonSectionKey } from '../types';
import type { PendingProposal } from './notePlanDrafts.client';
import type { ManualConspectus } from './useManualConspectus';
import type { Sermon, SermonPoint } from '@/models/models';

type Workspace = ReturnType<typeof useNotePlanGeneration> & { blocked: boolean; conspectus: ManualConspectus };
const NotePlanContext = createContext<Workspace | null>(null);
type WorkspaceProposal = Workspace['ready'][number];

function targetExists(sermon: Sermon, draft: PendingProposal | WorkspaceProposal) {
  const { outlinePointId, targetNodeId } = draft.request;
  return Object.values(sermon.outline ?? {}).flat().some(point =>
    point.id === outlinePointId && (!targetNodeId || planNodesForPoint(point).some(node => node.id === targetNodeId)));
}

function ActiveWorkspace({ sermon, conspectus, children }: { sermon: Sermon; conspectus: ManualConspectus; children: ReactNode }) {
  const { t } = useTranslation();
  const { aiBlocked, refresh } = useAiUsage();
  const sources = useSourceNotes(sermon);
  const sourceUnavailable = !sermon.sourceNoteIds?.length || sources.missingIds.length > 0;
  // Not the connection icon: pressing makes the request, and a failed one says so (owner, 2026-10-10).
  const blocked = aiBlocked || sourceUnavailable || sources.loading;
  const sourceText = useMemo(() => {
    const notes = new Map(sources.notes.map(note => [note.id, note]));
    const ids = [...new Set(sermon.sourceNoteIds)];
    const ordered = ids.flatMap(id => {
      const note = notes.get(id);
      return note ? [note] : [];
    });
    return ordered.length > 0 && ordered.length === ids.length ? notePlanSourceText(ordered) : undefined;
  }, [sermon.sourceNoteIds, sources.notes]);
  const generation = useNotePlanGeneration({ sermon, conspectus, blocked, sourceText, sourceMissing: sourceUnavailable, onSuccess: refresh });
  const detached = generation.ready.filter(draft => !targetExists(sermon, draft));
  const detachedPending = generation.pending.filter(draft => !targetExists(sermon, draft));
  return (
    <NotePlanContext.Provider value={{ ...generation, blocked: blocked || generation.sourceChecking, conspectus }}>
      <div className="space-y-4">
        {/* WHAT STOPS THE WORK, and nothing else. The link to the study used to live here inside
            a titled card with a paragraph of explanation; it now sits in the page header as the
            same chip the sermon carries, so this block draws nothing at all while everything is
            fine and only speaks when generation is actually held back. */}
        {(sources.loading || sourceUnavailable || aiBlocked) && (
          <div className="space-y-1 text-sm">
            {sources.loading && <p role="status" className="text-gray-500 dark:text-gray-400">{t('common.loading')}</p>}
            {sourceUnavailable && <p role="alert" className="text-amber-700 dark:text-amber-300">{t('plan.fromNote.sourceUnavailable')}</p>}
            {aiBlocked && <p role="status" className="text-gray-500 dark:text-gray-400">{t('plan.fromNote.usageBlocked')}</p>}
          </div>
        )}
        {detachedPending.map(draft => <PendingProposalCard key={draft.id} draft={draft} detached />)}
        {detached.map(proposal => <NoteProposalCard key={proposal.id} proposal={proposal} detached />)}
        <PlanStyleSelector value={generation.style} onChange={generation.setStyle} disabled={generation.busy} />
      </div>
      {children}
    </NotePlanContext.Provider>
  );
}

export function NotePlanWorkspace({ enabled, ...props }: {
  enabled: boolean; sermon: Sermon; conspectus: ManualConspectus; children: ReactNode;
}) {
  return enabled ? <ActiveWorkspace {...props} /> : <>{props.children}</>;
}

export function NotePointGenerateButton({ point, section, targetNodeId }: {
  point: SermonPoint; section: SermonSectionKey; targetNodeId?: string;
}) {
  const state = useContext(NotePlanContext);
  const { t } = useTranslation();
  if (!state) return null;
  const requestId = targetNodeId ?? point.id;
  const generating = Boolean(state.generatingIds[requestId]);
  const nodes = planNodesForPoint(point).filter((node) => !targetNodeId || node.id === targetNodeId);
  const overlapping = Boolean(state.generatingIds[point.id]) || nodes.some((node) => state.generatingIds[node.id]);
  const pending = nodes.some((node) => state.conspectus.pendingNodeIds.has(node.id));
  const pendingProposal = state.pending.some(draft => state.blocksGeneration(draft, nodes.map(node => node.id)));
  const deleting = nodes.some((node) => state.conspectus.busyNodeIds.has(node.id));
  const hasContent = nodes.some((node) => state.conspectus.contentByNodeId[node.id]?.trim());
  const label = targetNodeId ? 'plan.fromNote.generateSubPoint'
    : point.subPoints?.length ? 'plan.fromNote.generatePointWithSubPoints' : 'plan.fromNote.generatePoint';
  const colors = SERMON_SECTION_COLORS[section === 'main' ? 'mainPart' : section];
  return (
    <PlanGenerationButton colors={colors} generating={generating}
      id={`${refinementPanelId(requestId)}-trigger`}
      expanded={hasContent ? Boolean(state.refiningIds[requestId]) : undefined}
      controls={hasContent ? refinementPanelId(requestId) : undefined}
      disabled={deleting || overlapping || pending || pendingProposal || (!hasContent && state.blocked)} onClick={() => {
        if (hasContent) state.setRefining(requestId, !state.refiningIds[requestId]);
        else void state.generate(point, targetNodeId);
      }}
      label={t(generating ? 'plan.fromNote.generating' : hasContent ? 'plan.refine.open' : label)} />
  );
}

export function NotePointActions({ point, targetNodeId }: { point: SermonPoint; targetNodeId?: string }) {
  const state = useContext(NotePlanContext);
  const { t } = useTranslation();
  if (!state) return null;
  const requestId = targetNodeId ?? point.id;
  const nodes = planNodesForPoint(point).filter((node) => !targetNodeId || node.id === targetNodeId);
  const belongs = (draft: WorkspaceProposal | PendingProposal) =>
    draft.request.outlinePointId === point.id && draft.request.targetNodeId === targetNodeId;
  const proposals = state.ready.filter(belongs);
  const pending = state.pending.filter(belongs);
  const busy = Boolean(state.generatingIds[requestId]);
  const deleting = nodes.some((node) => state.conspectus.busyNodeIds.has(node.id));
  const disabled = deleting || state.blocked || Boolean(state.generatingIds[point.id])
    || nodes.some((node) => state.generatingIds[node.id] || state.conspectus.pendingNodeIds.has(node.id));
  const scope = targetNodeId
    ? t('plan.refine.scopeSubPoint', { title: nodes[0]?.heading })
    : t(point.subPoints?.length ? 'plan.refine.scopeWholePoint' : 'plan.refine.scopePoint', { title: point.text });
  return (
    <div className="mb-4 space-y-3">
      <NotePlanRefinement id={requestId} open={Boolean(state.refiningIds[requestId])} scope={scope}
        busy={busy} disabled={disabled} onClose={() => {
          state.setRefining(requestId, false);
          document.getElementById(`${refinementPanelId(requestId)}-trigger`)?.focus();
        }}
        onGenerate={(intent) => void state.generate(point, targetNodeId, intent)} />
      {state.errors[requestId] && !proposals.length && <p role="alert" className="text-sm text-amber-700 dark:text-amber-300">
        {t(state.errors[requestId] === 'draftStorage' ? 'draftStorage.title' : `plan.fromNote.${state.errors[requestId]}`)}
      </p>}
      {pending.map(draft => <PendingProposalCard key={draft.id} draft={draft} />)}
      {proposals.map(proposal => <NoteProposalCard key={proposal.id} proposal={proposal} deleting={deleting} />)}
      {state.missing[requestId] && <p role="status" className="text-sm text-amber-700 dark:text-amber-300">{state.missing[requestId]}</p>}
    </div>
  );
}

function PendingProposalCard({ draft, detached = false }: { draft: PendingProposal; detached?: boolean }) {
  const state = useContext(NotePlanContext)!;
  const { t } = useTranslation();
  const id = draft.request.targetNodeId ?? draft.request.outlinePointId;
  const busy = Boolean(state.generatingIds[id]);
  return <div className="space-y-2 rounded-lg border border-blue-200 p-3 dark:border-blue-900">
    {detached && <p className="font-medium">{t('plan.fromNote.detachedProposal')}</p>}
    <p role="status" className="text-sm">{t(busy ? 'plan.fromNote.generating'
      : state.obsoletePending(draft) ? 'plan.fromNote.contextChanged' : draft.unregistered ? 'plan.pointResultNotStarted' : 'errors.aiResultPending')}</p>
    <div className="flex flex-wrap gap-2">
      <Button variant="secondary" disabled={busy} onClick={() => void state.recover(draft.id)}>{t('plan.pointResultCheck')}</Button>
      {!detached && state.canResume(draft) && <Button disabled={busy}
        onClick={() => void state.recover(draft.id, true)}>{t('plan.pointResultResume')}</Button>}
    </div>
  </div>;
}

function NoteProposalCard({ proposal, deleting = false, detached = false }: {
  proposal: WorkspaceProposal; deleting?: boolean; detached?: boolean;
}) {
  const state = useContext(NotePlanContext)!;
  const { t } = useTranslation();
  const requestId = proposal.request.targetNodeId ?? proposal.request.outlinePointId;
  const waiting = state.proposalBlocked(proposal);
  const changed = state.proposalChanged(proposal);
  return (
    <div className="space-y-4 rounded-lg border border-blue-200 bg-blue-50/50 p-3 dark:border-blue-900 dark:bg-blue-950/20">
      <p className="font-medium">{t(detached ? 'plan.fromNote.detachedProposal' : 'plan.fromNote.proposal')}</p>
      {!detached && changed && !waiting && <p role="alert" className="text-sm text-amber-700 dark:text-amber-300">
        {t('plan.fromNote.contextChanged')}
      </p>}
      {Object.keys(proposal.labels).filter(id => proposal.contentByNodeId[id] || proposal.missingMaterial[id]).map(id => (
        <div key={id} className="space-y-2">
          <p className="text-sm font-semibold">{proposal.labels[id]}</p>
          <div className="grid gap-3 md:grid-cols-2">
            {!detached && <div className="min-w-0 rounded border border-gray-200 p-3 dark:border-gray-700">
              <p className="mb-2 text-xs text-gray-500">{t('plan.fromNote.current')}</p>
              <MarkdownDisplay content={state.conspectus.contentByNodeId[id] || t('plan.fromNote.empty')} />
            </div>}
            <div className="min-w-0 rounded border border-blue-200 p-3 dark:border-blue-900">
              <p className="mb-2 text-xs text-gray-500">{t('plan.fromNote.suggested')}</p>
              <MarkdownDisplay content={proposal.contentByNodeId[id] || t('plan.fromNote.empty')} />
              {proposal.missingMaterial[id] && <p className="mt-2 text-sm text-amber-700 dark:text-amber-300">{proposal.missingMaterial[id]}</p>}
            </div>
          </div>
        </div>
      ))}
      <div className="flex flex-wrap gap-2">
        {!detached && <Button variant="primary" className="disabled:cursor-not-allowed disabled:opacity-50"
          disabled={deleting || waiting || changed} onClick={() => state.accept(requestId, proposal)}>{t('plan.fromNote.apply')}</Button>}
        <Button variant="secondary" onClick={() => state.discard(requestId, proposal)}>{t('common.cancel')}</Button>
        {!detached && <Button onClick={() => state.setRefining(requestId, true)}>{t('plan.refine.adjustRequest')}</Button>}
      </div>
    </div>
  );
}

export function NoteNodeReminder({ text, hasPlan = false }: { text?: string; hasPlan?: boolean }) {
  const { t } = useTranslation();
  const contentId = useId();
  const [expanded, setExpanded] = useState(!hasPlan);

  useEffect(() => {
    setExpanded(!hasPlan);
  }, [hasPlan]);

  if (!text?.trim()) {
    return <p className={`mb-3 text-sm ${SCRATCH_REMINDER_COLORS.text}`}>{t('plan.fromNote.noReminder')}</p>;
  }

  return (
    <div className="mb-3 min-w-0">
      <button type="button" aria-expanded={expanded} aria-controls={contentId}
        onClick={() => setExpanded((previous) => !previous)}
        className={`flex min-h-11 items-center gap-2 rounded text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 ${SCRATCH_REMINDER_COLORS.toggle}`}>
        <ChevronRightIcon aria-hidden="true" className={`h-4 w-4 shrink-0 transition-transform motion-reduce:transition-none ${expanded ? 'rotate-90' : ''}`} />
        <LightBulbIcon aria-hidden="true" className="h-4 w-4 shrink-0" />
        <span>{t('scratch.card.label')}</span>
      </button>
      <div id={contentId} hidden={!expanded}
        className={`whitespace-pre-wrap break-words pb-2 pl-6 text-sm italic ${SCRATCH_REMINDER_COLORS.text}`}>{text}</div>
    </div>
  );
}
