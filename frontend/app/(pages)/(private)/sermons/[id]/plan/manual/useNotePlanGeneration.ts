'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

import { isUsageCapReachedError } from '@/services/usageLimits';
import { AI_RESULT_CONFLICT, AI_RESULT_NOT_STARTED, AI_RESULT_PENDING, AI_RESULT_UNAVAILABLE } from '@/utils/aiResultOperation';
import { browserInterfaceLanguage } from '@/utils/appLocale';
import { FetchTimeoutError } from '@/utils/fetchWithTimeout';
import { notePlanContextKey, notePlanTargetNodes, type NotePlanResult, type NotePlanRevisionIntent } from '@/utils/notePlan';

import { generateNotePlanContent } from '../planApi';
import { usePlanStylePreference } from '../usePlanStylePreference';

import { beginProposal, discardProposal, listProposals, readProposal, resolveProposal, watchProposals,
  type PendingProposal, type ProposalDraft, type ProposalScope, type ReadyProposal } from './notePlanDrafts.client';

import type { ManualConspectus } from './useManualConspectus';
import type { Sermon, SermonPoint } from '@/models/models';

type Proposal = ReadyProposal & NotePlanResult;

interface Options {
  sermon: Sermon;
  conspectus: ManualConspectus;
  blocked: boolean;
  sourceText?: string;
  sourceMissing?: boolean;
  onSuccess?: () => Promise<unknown>;
}

const allPoints = (sermon: Sermon) => [
  ...(sermon.outline?.introduction ?? []), ...(sermon.outline?.main ?? []), ...(sermon.outline?.conclusion ?? []),
];

const requestId = (draft: ProposalDraft) => draft.request.targetNodeId ?? draft.request.outlinePointId;

function proposalError(error: unknown) {
  if (isUsageCapReachedError(error)) return 'usageBlocked';
  return error instanceof Error && ['contextChanged', 'sourceUnavailable', 'sourceTooLarge'].includes(error.message)
    ? error.message : 'generationFailed';
}

function pendingFailure(error: unknown) {
  const failure = error as { code?: string; status?: number; name?: string } | undefined;
  if (failure?.code === AI_RESULT_PENDING || failure?.code === 'unauthenticated'
    || error instanceof FetchTimeoutError || error instanceof TypeError || error instanceof SyntaxError
    || failure?.name === 'AbortError') return true;
  if (failure?.code === AI_RESULT_UNAVAILABLE || failure?.code === AI_RESULT_CONFLICT) return false;
  return failure?.status === 401 || (failure?.status ?? 0) >= 500;
}

function matchesNodes(result: NotePlanResult, before: Record<string, string>) {
  const ids = Object.keys(before);
  return Object.keys(result.contentByNodeId).length === ids.length
    && ids.every(id => Object.hasOwn(result.contentByNodeId, id))
    && Object.keys(result.missingMaterial).every(id => Object.hasOwn(before, id));
}

function useSourceKey(text?: string) {
  const [version, setVersion] = useState<{ text: string; key: string }>();
  useEffect(() => {
    if (!text || !globalThis.crypto?.subtle) return;
    let active = true;
    void crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)).then(hash => {
      const key = Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('');
      if (active) setVersion({ text, key });
    }).catch(() => undefined);
    return () => { active = false; };
  }, [text]);
  return text === version?.text ? version?.key : undefined;
}

export function useNotePlanGeneration(options: Options) {
  const [style, setStyle] = usePlanStylePreference();
  const { userId: owner, id: sermonId } = options.sermon;
  const scope = useMemo(() => ({ owner, sermonId }), [owner, sermonId]);
  const sourceKey = useSourceKey(options.sourceText);
  const sourceChecking = Boolean(options.sourceText && globalThis.crypto?.subtle && !sourceKey);
  const [records, setRecords] = useState<{ scope: ProposalScope; items: ProposalDraft[] }>();
  const [generatingIds, setGeneratingIds] = useState<Record<string, boolean>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [missing, setMissing] = useState<Record<string, string>>({});
  const [refiningIds, setRefiningIds] = useState<Record<string, boolean>>({});
  const setRefining = (id: string, open: boolean) => setRefiningIds(previous => ({ ...previous, [id]: open }));
  const latest = useRef({ ...options, scope, sourceKey });
  latest.current = { ...options, scope, sourceKey };
  const requests = useRef(new Map<string, string>());
  const mounted = useRef(true);
  const isHere = () => mounted.current && latest.current.scope === scope;
  useEffect(() => {
    mounted.current = true;
    const refresh = () => setRecords({ scope, items: listProposals(scope) });
    refresh();
    const unwatch = watchProposals(scope, refresh);
    return () => { mounted.current = false; unwatch(); };
  }, [scope]);

  const items = records?.scope === scope ? records.items : [];
  const ready = items.flatMap(draft => draft.state === 'ready' ? [{ ...draft, ...draft.result }] : []);
  const proposals = Object.fromEntries([...ready].reverse().map(proposal => [requestId(proposal), proposal]));
  const pending = items.filter(draft => draft.state === 'pending');
  const failed = Object.fromEntries(items.filter(draft => draft.state === 'failed').reverse().map(draft => [requestId(draft), draft.error]));

  const unchanged = (draft: ProposalDraft) => {
    const current = latest.current;
    return current.scope === scope
      && notePlanContextKey(current.sermon, draft.request.outlinePointId) === draft.request.expectedContext
      && Object.entries(draft.before).every(([id, text]) => (current.conspectus.contentByNodeId[id] ?? '') === text);
  };

  const isCellUnavailable = (nodeId: string) => latest.current.conspectus.isTransferringText(nodeId)
    || latest.current.conspectus.busyNodeIds?.has(nodeId) || latest.current.conspectus.pendingNodeIds.has(nodeId);
  const proposalBlocked = (proposal: Proposal) => Object.keys(proposal.before).some(isCellUnavailable)
    || Boolean(proposal.sourceKey && !latest.current.sourceKey && !latest.current.sourceMissing);
  const proposalChanged = (proposal: Proposal) => proposal.sourceChanged === true || !unchanged(proposal)
    || Boolean(proposal.sourceKey && (latest.current.sourceMissing
      || latest.current.sourceKey && latest.current.sourceKey !== proposal.sourceKey));

  const accept = (id: string, proposal = proposals[id]) => {
    if (!proposal || !isHere() || readProposal(scope, proposal.id)?.state !== 'ready' || proposalBlocked(proposal)) return false;
    if (proposalChanged(proposal)) {
      setErrors(previous => ({ ...previous, [id]: 'contextChanged' }));
      return false;
    }
    // An empty generated cell must not replace the preacher's existing words.
    const cells = Object.fromEntries(Object.entries(proposal.contentByNodeId).filter(([, text]) => text.trim()));
    const { conspectus } = latest.current;
    const apply = conspectus.applyGeneratedCells ?? conspectus.restoreCells;
    if (!apply(cells)) return false;
    setMissing(previous => {
      const next = { ...previous };
      Object.keys(proposal.before).forEach(nodeId => { delete next[nodeId]; });
      return { ...next, ...proposal.missingMaterial };
    });
    discardProposal(scope, proposal);
    return true;
  };

  const refreshUsage = () => { if (isHere()) void latest.current.onSuccess?.().catch(() => undefined); };

  const send = async (draft: PendingProposal, recoverOnly: boolean) => {
    const id = requestId(draft);
    const tasks = requests.current;
    if (tasks.has(draft.id)) return;
    tasks.set(draft.id, id);
    if (isHere()) setGeneratingIds(previous => ({ ...previous, [id]: true }));
    try {
      const result = await generateNotePlanContent({ sermonId, ...draft.request }, undefined, {
        ownerId: owner, operationId: draft.id, recoverOnly, language: draft.language,
      });
      if (!matchesNodes(result, draft.before)) throw new Error('Invalid generated node map');
      resolveProposal(scope, { ...draft, state: 'ready', result });
      if (isHere()) {
        setRefining(id, false);
        if (!unchanged(draft)) setErrors(previous => ({ ...previous, [id]: 'contextChanged' }));
      }
      refreshUsage();
    } catch (error) {
      if ((error as { code?: string } | null)?.code === AI_RESULT_NOT_STARTED) {
        resolveProposal(scope, { ...draft, unregistered: true });
      } else if (!pendingFailure(error)) {
        const code = proposalError(error);
        resolveProposal(scope, { ...draft, state: 'failed', error: code });
        if (code === 'usageBlocked') refreshUsage();
      }
    } finally {
      tasks.delete(draft.id);
      if (isHere()) setGeneratingIds(previous => {
        const next = { ...previous };
        delete next[id];
        return next;
      });
    }
  };

  const obsoletePending = (draft: PendingProposal) => Boolean(draft.unregistered && (!unchanged(draft)
    || draft.request.expectedSourceKey && latest.current.sourceKey && draft.request.expectedSourceKey !== latest.current.sourceKey));
  const blocksGeneration = (draft: PendingProposal, nodeIds: string[]) => !obsoletePending(draft)
    && nodeIds.some(id => Object.hasOwn(draft.before, id));
  const hasPendingOverlap = (nodeIds: string[]) => listProposals(scope).some(draft =>
    draft.state === 'pending' && blocksGeneration(draft, nodeIds));

  const generate = async (point: SermonPoint, targetNodeId?: string, intent?: NotePlanRevisionIntent) => {
    const current = latest.current;
    if (current.blocked || sourceChecking || !isHere()) return;
    const currentPoint = allPoints(current.sermon).find(candidate => candidate.id === point.id);
    if (!currentPoint) return;
    const nodes = notePlanTargetNodes(currentPoint, targetNodeId);
    const nodeIds = nodes.map(node => node.nodeId);
    if (!nodeIds.length || nodeIds.some(isCellUnavailable) || hasPendingOverlap(nodeIds)) return;
    const id = targetNodeId ?? point.id;
    const before = Object.fromEntries(nodeIds.map(nodeId => [nodeId, current.conspectus.contentByNodeId[nodeId] ?? '']));
    const request = {
      outlinePointId: point.id, targetNodeId, style,
      expectedContext: notePlanContextKey(current.sermon, point.id),
      expectedSourceKey: current.sourceKey,
      ...(intent && { revision: { ...intent, currentContentByNodeId: before } }),
    };
    const draft = beginProposal(scope, {
      request, before, language: browserInterfaceLanguage(),
      labels: Object.fromEntries(nodes.map(node => [node.nodeId, node.title])),
    });
    setErrors(previous => {
      const next = { ...previous };
      if (draft) delete next[id];
      else next[id] = 'draftStorage';
      return next;
    });
    if (!draft) return;
    for (const item of listProposals(scope)) {
      if (item.state === 'failed' && requestId(item) === id) discardProposal(scope, item);
    }
    await send(draft, false);
  };

  const canResume = (draft: PendingProposal) => Boolean(draft.unregistered && !latest.current.blocked
    && !sourceChecking && unchanged(draft) && !Object.keys(draft.before).some(isCellUnavailable)
    && (!draft.request.expectedSourceKey || draft.request.expectedSourceKey === latest.current.sourceKey));

  const recover = async (id: string, resume = false) => {
    if (!isHere()) return;
    const draft = readProposal(scope, id);
    if (draft?.state !== 'pending' || resume && !canResume(draft)) return;
    await send(draft, !resume);
  };

  return {
    style, setStyle, generatingIds, busy: Object.values(generatingIds).some(Boolean),
    ready, pending, proposals, errors: { ...failed, ...errors }, missing,
    generate, recover, canResume, obsoletePending, blocksGeneration, accept, sourceChecking, proposalBlocked, proposalChanged, refiningIds, setRefining,
    discard: (id: string, proposal = proposals[id]) => { if (proposal) discardProposal(scope, proposal); },
  };
}
