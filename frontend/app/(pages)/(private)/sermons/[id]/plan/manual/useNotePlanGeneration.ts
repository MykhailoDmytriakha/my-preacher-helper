'use client';

import { useEffect, useRef, useState } from 'react';

import { isUsageCapReachedError } from '@/services/usageLimits';
import { notePlanContextKey, notePlanTargetNodes, type NotePlanResult } from '@/utils/notePlan';

import { generateNotePlanContent } from '../planApi';
import { usePlanStylePreference } from '../usePlanStylePreference';

import type { ManualConspectus } from './useManualConspectus';
import type { Sermon, SermonPoint } from '@/models/models';

interface Proposal extends NotePlanResult {
  pointId: string;
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
  const [style, setStyle] = usePlanStylePreference();
  const [generatingIds, setGeneratingIds] = useState<Record<string, boolean>>({});
  const [proposals, setProposals] = useState<Record<string, Proposal>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [missing, setMissing] = useState<Record<string, string>>({});
  const latest = useRef(options);
  latest.current = options;
  const requests = useRef(new Map<string, AbortController>());
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    const activeRequests = requests.current;
    return () => {
      mounted.current = false;
      activeRequests.forEach((controller) => controller.abort());
      activeRequests.clear();
    };
  }, []);

  const unchanged = (proposal: Proposal) => {
    const current = latest.current;
    return current.sermon.id === proposal.sermonId
      && notePlanContextKey(current.sermon, proposal.pointId) === proposal.context
      && Object.entries(proposal.before).every(([id, text]) => (current.conspectus.contentByNodeId[id] ?? '') === text);
  };

  const accept = (pointId: string, proposal = proposals[pointId]) => {
    if (!proposal || !unchanged(proposal)) {
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

  const runPoint = async (point: SermonPoint, controller: AbortController, targetNodeId?: string) => {
    const current = latest.current;
    const requestId = targetNodeId ?? point.id;
    if (current.blocked || !mounted.current) return;
    const currentPoint = allPoints(current.sermon).find((candidate) => candidate.id === point.id);
    if (!currentPoint) return;
    const nodeIds = notePlanTargetNodes(currentPoint, targetNodeId).map((node) => node.nodeId);
    if (!nodeIds.length) return;
    if (nodeIds.some((id) => current.conspectus.pendingNodeIds.has(id))) return;
    const before = Object.fromEntries(nodeIds.map((id) => [id, current.conspectus.contentByNodeId[id] ?? '']));
    const context = notePlanContextKey(current.sermon, point.id);
    const sermonId = current.sermon.id;
    setErrors((previous) => { const next = { ...previous }; delete next[requestId]; return next; });
    // A new request supersedes only proposals that could write the same cells.
    setProposals((previous) => Object.fromEntries(Object.entries(previous)
      .filter(([, proposal]) => !nodeIds.some((id) => id in proposal.before))));
    try {
      const result = await generateNotePlanContent({ sermonId, outlinePointId: point.id, targetNodeId, style, expectedContext: context }, controller.signal);
      if (!mounted.current || controller.signal.aborted) return;
      if (Object.keys(result.contentByNodeId).length !== nodeIds.length
        || Object.keys(result.contentByNodeId).some((id) => !nodeIds.includes(id))
        || Object.keys(result.missingMaterial).some((id) => !nodeIds.includes(id))) {
        throw new Error('Invalid generated node map');
      }
      const proposal = { ...result, before, context, sermonId, pointId: point.id };
      if (!unchanged(proposal)) {
        setErrors((previous) => ({ ...previous, [requestId]: 'contextChanged' }));
        return;
      }
      setProposals((previous) => ({ ...previous, [requestId]: proposal }));
      void current.onSuccess?.().catch(() => undefined);
    } catch (error) {
      if (!mounted.current || controller.signal.aborted) return;
      const code = generationErrorCode(error);
      setErrors((previous) => ({ ...previous, [requestId]: code }));
      if (code === 'usageBlocked') void current.onSuccess?.().catch(() => undefined);
    }
  };

  const generate = async (point: SermonPoint, targetNodeId?: string) => {
    const requestId = targetNodeId ?? point.id;
    const currentPoint = allPoints(latest.current.sermon).find((candidate) => candidate.id === point.id);
    if (!currentPoint) return;
    const scope = notePlanTargetNodes(currentPoint, targetNodeId);
    if (!scope.length || requests.current.has(point.id)
      || scope.some((node) => requests.current.has(node.nodeId))
      || latest.current.blocked || !mounted.current) return;
    const controller = new AbortController();
    requests.current.set(requestId, controller);
    setGeneratingIds((previous) => ({ ...previous, [requestId]: true }));
    try { await runPoint(point, controller, targetNodeId); }
    finally {
      // An old completion must not clear a newer request after effect cleanup/remount.
      if (requests.current.get(requestId) === controller) {
        requests.current.delete(requestId);
        if (mounted.current) setGeneratingIds((previous) => {
          const next = { ...previous };
          delete next[requestId];
          return next;
        });
      }
    }
  };

  return {
    style, setStyle, generatingIds, busy: Object.values(generatingIds).some(Boolean),
    proposals, errors, missing, generate, accept,
    discard: (pointId: string) => setProposals((previous) => { const next = { ...previous }; delete next[pointId]; return next; }),
  };
}
