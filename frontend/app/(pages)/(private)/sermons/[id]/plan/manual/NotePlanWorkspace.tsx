'use client';

import { ChevronRightIcon, LightBulbIcon } from '@heroicons/react/24/outline';
import { createContext, useContext, useEffect, useId, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import MarkdownDisplay from '@/components/MarkdownDisplay';
import PlanGenerationButton from '@/components/plan/PlanGenerationButton';
import PlanStyleSelector from '@/components/plan/PlanStyleSelector';
import { Button } from '@/components/ui/Button';
import { useAiUsage } from '@/hooks/useAiUsage';
import { useOnlineStatus } from '@/hooks/useOnlineStatus';
import { useSourceNotes } from '@/hooks/useSermonNoteLinks';
import { SCRATCH_REMINDER_COLORS, SERMON_SECTION_COLORS } from '@/utils/themeColors';

import { planNodesForPoint } from '../planNodes';

import NotePlanRefinement, { refinementPanelId } from './NotePlanRefinement';
import { useNotePlanGeneration } from './useNotePlanGeneration';

import type { SermonSectionKey } from '../types';
import type { ManualConspectus } from './useManualConspectus';
import type { Sermon, SermonPoint } from '@/models/models';

type Workspace = ReturnType<typeof useNotePlanGeneration> & { blocked: boolean; conspectus: ManualConspectus };
const NotePlanContext = createContext<Workspace | null>(null);

function ActiveWorkspace({ sermon, conspectus, children }: { sermon: Sermon; conspectus: ManualConspectus; children: ReactNode }) {
  const { t } = useTranslation();
  const { aiBlocked, refresh } = useAiUsage();
  const online = useOnlineStatus();
  const sources = useSourceNotes(sermon);
  const sourceUnavailable = !sermon.sourceNoteIds?.length || sources.missingIds.length > 0;
  const blocked = !online || aiBlocked || sourceUnavailable || sources.loading;
  const generation = useNotePlanGeneration({ sermon, conspectus, blocked, onSuccess: refresh });
  return (
    <NotePlanContext.Provider value={{ ...generation, blocked, conspectus }}>
      <div className="space-y-4">
        <div className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
          <p className="mb-2 text-sm font-medium text-gray-700 dark:text-gray-200">{t('plan.fromNote.source')}</p>
          <div className="flex flex-wrap gap-2">
            {sources.notes.map((note) => (
              <a key={note.id} href={`/studies/${note.id}`} target="_blank" rel="noopener noreferrer"
                className="text-sm text-blue-600 underline decoration-blue-300 underline-offset-4 dark:text-blue-300">
                {note.title || t('studiesWorkspace.untitled')}
              </a>
            ))}
          </div>
          <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">{t('plan.fromNote.sourceHelp')}</p>
          {sources.loading && <p role="status">{t('common.loading')}</p>}
          {sourceUnavailable && <p role="alert" className="mt-2 text-sm text-amber-700 dark:text-amber-300">{t('plan.fromNote.sourceUnavailable')}</p>}
          {!online && <p role="status" className="mt-2 text-sm">{t('connection.offlineBanner')}</p>}
          {aiBlocked && <p role="status" className="mt-2 text-sm">{t('plan.fromNote.usageBlocked')}</p>}
        </div>
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
  const hasContent = nodes.some((node) => state.conspectus.contentByNodeId[node.id]?.trim());
  const label = targetNodeId ? 'plan.fromNote.generateSubPoint'
    : point.subPoints?.length ? 'plan.fromNote.generatePointWithSubPoints' : 'plan.fromNote.generatePoint';
  const colors = SERMON_SECTION_COLORS[section === 'main' ? 'mainPart' : section];
  return (
    <PlanGenerationButton colors={colors} generating={generating}
      id={`${refinementPanelId(requestId)}-trigger`}
      expanded={hasContent ? Boolean(state.refiningIds[requestId]) : undefined}
      controls={hasContent ? refinementPanelId(requestId) : undefined}
      disabled={overlapping || pending || (!hasContent && state.blocked)} onClick={() => {
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
  const proposal = state.proposals[requestId];
  const busy = Boolean(state.generatingIds[requestId]);
  const disabled = state.blocked || Boolean(state.generatingIds[point.id])
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
      {state.errors[requestId] && <p role="alert" className="text-sm text-amber-700 dark:text-amber-300">{t(`plan.fromNote.${state.errors[requestId]}`)}</p>}
      {proposal && (
        <div className="space-y-4 rounded-lg border border-blue-200 bg-blue-50/50 p-3 dark:border-blue-900 dark:bg-blue-950/20">
          <p className="font-medium">{t('plan.fromNote.proposal')}</p>
          {nodes.filter((node) => proposal.contentByNodeId[node.id] || proposal.missingMaterial[node.id]).map((node) => (
            <div key={node.id} className="space-y-2">
              <p className="text-sm font-semibold">{node.heading || point.text}</p>
              <div className="grid gap-3 md:grid-cols-2">
                <div className="min-w-0 rounded border border-gray-200 p-3 dark:border-gray-700">
                  <p className="mb-2 text-xs text-gray-500">{t('plan.fromNote.current')}</p>
                  <MarkdownDisplay content={state.conspectus.contentByNodeId[node.id] || t('plan.fromNote.empty')} />
                </div>
                <div className="min-w-0 rounded border border-blue-200 p-3 dark:border-blue-900">
                  <p className="mb-2 text-xs text-gray-500">{t('plan.fromNote.suggested')}</p>
                  <MarkdownDisplay content={proposal.contentByNodeId[node.id] || t('plan.fromNote.empty')} />
                  {proposal.missingMaterial[node.id] && <p className="mt-2 text-sm text-amber-700 dark:text-amber-300">{proposal.missingMaterial[node.id]}</p>}
                </div>
              </div>
            </div>
          ))}
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" onClick={() => state.accept(requestId)}>{t('plan.fromNote.apply')}</Button>
            <Button variant="secondary" onClick={() => state.discard(requestId)}>{t('common.cancel')}</Button>
            <Button onClick={() => state.setRefining(requestId, true)}>{t('plan.refine.adjustRequest')}</Button>
          </div>
        </div>
      )}
      {state.missing[requestId] && <p role="status" className="text-sm text-amber-700 dark:text-amber-300">{state.missing[requestId]}</p>}
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
