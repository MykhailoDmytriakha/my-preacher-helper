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

/**
 * The cells of the card a proposal stands beside, in the card's order — or null when none of them
 * is left. A proposal whose every written cell was removed is read on its own card; otherwise its
 * Cancel would stand under no cell at all and the paid text could not even be dismissed. Partly
 * removed, it stays beside what is left, where the changed context already blocks "Use".
 */
const writtenCells = (proposal: WorkspaceProposal) =>
  Object.keys(proposal.labels).filter(id => proposal.contentByNodeId[id] || proposal.missingMaterial[id]);

function proposalCells(proposal: WorkspaceProposal, point: SermonPoint) {
  const written = writtenCells(proposal);
  const ids = written.length ? written : [proposal.request.targetNodeId ?? proposal.request.outlinePointId];
  const cells = planNodesForPoint(point).map(node => node.id).filter(id => ids.includes(id));
  return cells.length ? cells : null;
}

function isAttached(sermon: Sermon, proposal: WorkspaceProposal) {
  const point = Object.values(sermon.outline ?? {}).flat().find(candidate => candidate.id === proposal.request.outlinePointId);
  return Boolean(point && targetExists(sermon, proposal) && proposalCells(proposal, point));
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
  const detached = generation.ready.filter(draft => !isAttached(sermon, draft));
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
        {detached.map(proposal => <DetachedProposalCard key={proposal.id} proposal={proposal} />)}
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
    <div className="mb-4 space-y-3 empty:hidden">
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
      {state.missing[requestId] && <p role="status" className="text-sm text-amber-700 dark:text-amber-300">{state.missing[requestId]}</p>}
    </div>
  );
}

function PendingProposalCard({ draft, detached = false }: { draft: PendingProposal; detached?: boolean }) {
  const state = useContext(NotePlanContext)!;
  const { t } = useTranslation();
  const id = draft.request.targetNodeId ?? draft.request.outlinePointId;
  const busy = Boolean(state.generatingIds[id]);
  // While the request runs, the point's spinning button already says so; a second "Generating…"
  // box under it said the same thing again with a button that had nothing to check yet. A removed
  // point has no button left, so its own card keeps saying it.
  if (busy && !detached) return null;
  return <div className="space-y-2 rounded-lg border border-blue-200 p-3 dark:border-blue-900">
    {detached && <p className="font-medium">{t('plan.fromNote.detachedProposal')}</p>}
    <p role="status" className="text-sm">{t(busy ? 'plan.fromNote.generating' : state.obsoletePending(draft) ? 'plan.fromNote.contextChanged'
      : draft.unregistered ? 'plan.pointResultNotStarted' : 'errors.aiResultPending')}</p>
    <div className="flex flex-wrap gap-2">
      <Button variant="secondary" disabled={busy} onClick={() => void state.recover(draft.id)}>{t('plan.pointResultCheck')}</Button>
      {!detached && state.canResume(draft) && <Button
        onClick={() => void state.recover(draft.id, true)}>{t('plan.pointResultResume')}</Button>}
    </div>
  </div>;
}

/**
 * THE NEW VERSION STANDS NEXT TO THE TEXT IT WOULD REPLACE.
 *
 * The cell's own text stays where it always is, shown once, and the proposal stands to its
 * right. A separate review card repeated the same words under "Now" above the cell, so the
 * preacher read his text twice and could not tell which copy was the real one (owner,
 * 2026-11-21). Earlier paid proposals that overlap this cell are kept, so they stack here.
 */
export function NoteNodeText({ point, nodeId, children }: { point: SermonPoint; nodeId: string; children: ReactNode }) {
  const state = useContext(NotePlanContext);
  const { t } = useTranslation();
  if (!state) return <>{children}</>;
  const order = planNodesForPoint(point).map(node => node.id);
  const shown = state.ready.flatMap(proposal => {
    const cells = proposal.request.outlinePointId === point.id ? proposalCells(proposal, point) : null;
    return cells?.includes(nodeId) ? [{ proposal, last: cells.at(-1) === nodeId }] : [];
  });
  // The part written for a cell removed since stays readable under the buttons, not silently gone.
  const removedCells = (proposal: WorkspaceProposal) => writtenCells(proposal).filter(id => !order.includes(id));
  const [first, ...more] = shown;
  // ONE GRID FOR THE PAIR, AND ONE SHAPE WHETHER OR NOT A VERSION IS OPEN. Labels share a row,
  // the two texts share a row and so a height, the buttons stand under the new version. On a
  // phone the same elements stack in reading order. The cell's own text keeps its place in the
  // tree either way, so an editor inside it is not rebuilt when a proposal arrives or is chosen.
  return (
    <div className={first ? 'grid gap-x-4 gap-y-2 lg:grid-cols-2' : undefined}>
      {first && <p className={`${PAIR_LABEL} text-gray-500 dark:text-gray-400 lg:col-start-1 lg:row-start-1`}>{t('plan.fromNote.current')}</p>}
      <div className={first ? 'min-w-0 lg:col-start-1 lg:row-start-2 [&>*]:h-full' : undefined}>
        {children}
      </div>
      {first && <>
        <p className={`${PAIR_LABEL} text-blue-700 dark:text-blue-300 lg:col-start-2 lg:row-start-1`}>{t('plan.fromNote.suggested')}</p>
        <ProposalText proposal={first.proposal} nodeId={nodeId} className="lg:col-start-2 lg:row-start-2" />
        {first.last && <ProposalActions proposal={first.proposal} removed={removedCells(first.proposal)}
          className="lg:col-start-2 lg:row-start-3" />}
        {more.length > 0 && <div className="min-w-0 space-y-4 lg:col-start-2 lg:row-start-4">
          {more.map(({ proposal, last }) => <div key={proposal.id} className="space-y-2">
            <p className={`${PAIR_LABEL} text-blue-700 dark:text-blue-300`}>{t('plan.fromNote.suggested')}</p>
            <ProposalText proposal={proposal} nodeId={nodeId} />
            {last && <ProposalActions proposal={proposal} removed={removedCells(proposal)} />}
          </div>)}
        </div>}
      </>}
    </div>
  );
}

const PAIR_LABEL = 'text-xs font-medium';

function ProposalText({ proposal, nodeId, className = '' }: { proposal: WorkspaceProposal; nodeId: string; className?: string }) {
  const { t } = useTranslation();
  return (
    <div className={`min-w-0 rounded-md border border-blue-300 bg-blue-50/60 p-4 dark:border-blue-800 dark:bg-blue-950/30 ${className}`}>
      <MarkdownDisplay content={proposal.contentByNodeId[nodeId] || t('plan.fromNote.empty')} />
      {proposal.missingMaterial[nodeId] && <p className="mt-2 text-sm text-amber-700 dark:text-amber-300">{proposal.missingMaterial[nodeId]}</p>}
    </div>
  );
}

function ProposalActions({ proposal, removed = [], className = '' }: { proposal: WorkspaceProposal; removed?: string[]; className?: string }) {
  const state = useContext(NotePlanContext)!;
  const { t } = useTranslation();
  const requestId = proposal.request.targetNodeId ?? proposal.request.outlinePointId;
  const waiting = state.proposalBlocked(proposal);
  const changed = state.proposalChanged(proposal);
  return (
    <div className={`min-w-0 space-y-2 ${className}`}>
      {removed.map(id => <div key={id} className="space-y-1 rounded-md border border-dashed border-blue-300 p-4 dark:border-blue-800">
        <p className="text-sm font-semibold">{proposal.labels[id]}</p>
        <MarkdownDisplay content={proposal.contentByNodeId[id] || t('plan.fromNote.empty')} />
        {proposal.missingMaterial[id] && <p className="text-sm text-amber-700 dark:text-amber-300">{proposal.missingMaterial[id]}</p>}
      </div>)}
      {changed && !waiting && <p role="alert" className="text-sm text-amber-700 dark:text-amber-300">
        {t('plan.fromNote.contextChanged')}
      </p>}
      <div className="flex flex-wrap gap-2">
        <Button variant="primary" disabled={waiting || changed} onClick={() => state.accept(requestId, proposal)}>{t('plan.fromNote.apply')}</Button>
        <Button variant="secondary" onClick={() => state.discard(requestId, proposal)}>{t('common.cancel')}</Button>
        <Button onClick={() => state.setRefining(requestId, true)}>{t('plan.refine.adjustRequest')}</Button>
      </div>
    </div>
  );
}

/** A proposal whose point or sub-point is gone: nothing to stand beside, only its text to read or drop. */
function DetachedProposalCard({ proposal }: { proposal: WorkspaceProposal }) {
  const state = useContext(NotePlanContext)!;
  const { t } = useTranslation();
  const requestId = proposal.request.targetNodeId ?? proposal.request.outlinePointId;
  return (
    <div className="space-y-4 rounded-lg border border-blue-200 bg-blue-50/50 p-3 dark:border-blue-900 dark:bg-blue-950/20">
      <p className="font-medium">{t('plan.fromNote.detachedProposal')}</p>
      {Object.keys(proposal.labels).filter(id => proposal.contentByNodeId[id] || proposal.missingMaterial[id]).map(id => (
        <div key={id} className="min-w-0 space-y-2 rounded-md border border-blue-200 p-4 dark:border-blue-900">
          <p className="text-sm font-semibold">{proposal.labels[id]}</p>
          <MarkdownDisplay content={proposal.contentByNodeId[id] || t('plan.fromNote.empty')} />
          {proposal.missingMaterial[id] && <p className="text-sm text-amber-700 dark:text-amber-300">{proposal.missingMaterial[id]}</p>}
        </div>
      ))}
      <Button variant="secondary" onClick={() => state.discard(requestId, proposal)}>{t('common.cancel')}</Button>
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
    // As tall as the reminder's own toggle row, so cards with and without one start their text level.
    return <p className={`mb-3 flex min-h-11 items-center text-sm ${SCRATCH_REMINDER_COLORS.text}`}>{t('plan.fromNote.noReminder')}</p>;
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
        className={`whitespace-pre-wrap break-words pb-2 pl-12 text-sm italic ${SCRATCH_REMINDER_COLORS.text}`}>{text}</div>
    </div>
  );
}
