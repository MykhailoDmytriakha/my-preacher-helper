import { actionBlockedLabelKey, isActionBlocked, type BlockedResources } from '@/utils/usageGates';

/**
 * THE STUB IS BUILT FROM THE REAL TABLE, NOT FROM A SECOND COPY OF IT.
 *
 * `useAiUsage` answers questions about ACTIONS, and the answer comes from `usageGates`. A stub
 * that hand-rolled those answers would be free to disagree with the table — which is precisely
 * the defect this hook exists to prevent: a gate that says one thing while the request spends
 * another. Suites hand it raw allowances; the action answers are derived.
 */
export const aiUsageStub = (overrides: {
  aiBlocked?: boolean;
  transcriptionBlocked?: boolean;
  audioBlocked?: boolean;
  aiRemaining?: number;
  transcriptionRemaining?: number;
  loading?: boolean;
  refresh?: () => Promise<void> | void;
} = {}) => {
  const blockedResources: BlockedResources = {
    ai: overrides.aiBlocked ?? false,
    transcription: overrides.transcriptionBlocked ?? false,
    audio: overrides.audioBlocked ?? false,
  };

  return {
    aiRemaining: overrides.aiRemaining ?? 10,
    aiBlocked: blockedResources.ai ?? false,
    transcriptionRemaining: overrides.transcriptionRemaining ?? 60,
    transcriptionBlocked: blockedResources.transcription ?? false,
    audioBlocked: blockedResources.audio ?? false,
    blocked: (action: Parameters<typeof isActionBlocked>[0]) => isActionBlocked(action, blockedResources),
    blockedLabelKey: (action: Parameters<typeof actionBlockedLabelKey>[0]) =>
      actionBlockedLabelKey(action, blockedResources),
    loading: overrides.loading ?? false,
    refresh: overrides.refresh ?? (() => Promise.resolve()),
  };
};
