'use client';

import { useEffect, useRef, useState } from 'react';

import { isUsageCapReachedError } from '@/services/usageLimits';
import { notePlanContextKey, type NotePlanResult } from '@/utils/notePlan';

import { generateNotePlanContent } from '../planApi';
import { planNodesForPoint } from '../planNodes';

import type { ManualConspectus } from './useManualConspectus';
import type { PlanStyle } from '@/api/clients/planTypes';
import type { Sermon, SermonPoint } from '@/models/models';

interface Proposal extends NotePlanResult {
  before: Record<string, string>;
  context: string;
  sermonId: string;
}

interface Options {
  sermon: Sermon;
  conspectus: ManualConspectus;
  blocked: boolean;
  onSuccess?: () => Promise<unknown>;
}

const allPoints = (sermon: Sermon) => [
  ...(sermon.outline?.introduction ?? []), ...(sermon.outline?.main ?? []), ...(sermon.outline?.conclusion ?? []),
];

function generationErrorCode(error: unknown): string {
  if (isUsageCapReachedError(error)) return 'usageBlocked';
  if (error instanceof Error && ['contextChanged', 'sourceUnavailable', 'sourceTooLarge'].includes(error.message)) {
    return error.message;
  }
  return 'generationFailed';
}

export function useNotePlanGeneration(options: Options) {
  const [style, setStyle] = useState<PlanStyle>('memory');
  const [activeId, setActiveId] = useState<string | null>(null);
  const [batch, setBatch] = useState(false);
  const [proposals, setProposals] = useState<Record<string, Proposal>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [missing, setMissing] = useState<Record<string, string>>({});
  const latest = useRef(options);
  latest.current = options;
  const running = useRef(false);
  const abort = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; abort.current?.abort(); };
  }, []);

  const unchanged = (pointId: string, proposal: Proposal) => {
    const current = latest.current;
    return current.sermon.id === proposal.sermonId
      && notePlanContextKey(current.sermon, pointId) === proposal.context
      && Object.entries(proposal.before).every(([id, text]) => (current.conspectus.contentByNodeId[id] ?? '') === text);
  };

  const accept = (pointId: string, proposal = proposals[pointId]) => {
    if (!proposal || !unchanged(pointId, proposal)) {
      setErrors((previous) => ({ ...previous, [pointId]: 'contextChanged' }));
      return false;
    }
    // A missing source must never erase existing writing with an empty generated cell.
    const cells = Object.fromEntries(Object.entries(proposal.contentByNodeId).filter(([, text]) => text.trim()));
    latest.current.conspectus.restoreCells(cells);
    setMissing((previous) => {
      const next = { ...previous };
      Object.keys(proposal.before).forEach((id) => { delete next[id]; });
      return { ...next, ...proposal.missingMaterial };
    });
    setProposals((previous) => { const next = { ...previous }; delete next[pointId]; return next; });
    return true;
  };

  const runPoint = async (point: SermonPoint, autoApply: boolean) => {
    const current = latest.current;
    if (current.blocked || !mounted.current) return;
    const currentPoint = allPoints(current.sermon).find((candidate) => candidate.id === point.id);
    if (!currentPoint) return;
    const nodeIds = planNodesForPoint(currentPoint).map((node) => node.id);
    if (nodeIds.some((id) => current.conspectus.pendingNodeIds.has(id))) return;
    const before = Object.fromEntries(nodeIds.map((id) => [id, current.conspectus.contentByNodeId[id] ?? '']));
    if (autoApply && Object.values(before).some((text) => text.trim())) return;
    const context = notePlanContextKey(current.sermon, point.id);
    const sermonId = current.sermon.id;
    setActiveId(point.id);
    setErrors((previous) => { const next = { ...previous }; delete next[point.id]; return next; });
    abort.current = new AbortController();
    try {
      const result = await generateNotePlanContent({ sermonId, outlinePointId: point.id, style, expectedContext: context }, abort.current.signal);
      if (!mounted.current) return;
      if (Object.keys(result.contentByNodeId).length !== nodeIds.length
        || Object.keys(result.contentByNodeId).some((id) => !nodeIds.includes(id))) {
        throw new Error('Invalid generated node map');
      }
      const proposal = { ...result, before, context, sermonId };
      if (!unchanged(point.id, proposal)) {
        setErrors((previous) => ({ ...previous, [point.id]: 'contextChanged' }));
        return;
      }
      if (autoApply) accept(point.id, proposal);
      else setProposals((previous) => ({ ...previous, [point.id]: proposal }));
      void current.onSuccess?.().catch(() => undefined);
    } catch (error) {
      if (!mounted.current || abort.current.signal.aborted) return;
      const code = generationErrorCode(error);
      setErrors((previous) => ({ ...previous, [point.id]: code }));
      // A batch cannot keep spending requests after an account or source refusal.
      if (code !== 'generationFailed') throw error;
    }
  };

  const generate = async (point: SermonPoint) => {
    if (running.current || latest.current.blocked) return;
    running.current = true;
    try { await runPoint(point, false); } catch { /* The point carries the error. */ }
    finally { running.current = false; if (mounted.current) setActiveId(null); }
  };

  const fillEmpty = async () => {
    if (running.current || latest.current.blocked) return;
    running.current = true;
    setBatch(true);
    const sermonId = latest.current.sermon.id;
    try {
      for (const point of allPoints(latest.current.sermon)) {
        if (!mounted.current || latest.current.sermon.id !== sermonId) break;
        if (proposals[point.id]) continue;
        await runPoint(point, true);
      }
    } catch { /* Stop on a source, context or allowance refusal; completed drafts remain. */ }
    finally { running.current = false; if (mounted.current) { setBatch(false); setActiveId(null); } }
  };

  const emptyCount = allPoints(options.sermon).filter((point) => !proposals[point.id]
    && planNodesForPoint(point).every((node) => !options.conspectus.contentByNodeId[node.id]?.trim()
      && !options.conspectus.pendingNodeIds.has(node.id))).length;

  return {
    style, setStyle, activeId, batch, busy: batch || activeId !== null,
    proposals, errors, missing, generate, fillEmpty, accept, emptyCount,
    discard: (pointId: string) => setProposals((previous) => { const next = { ...previous }; delete next[pointId]; return next; }),
  };
}
