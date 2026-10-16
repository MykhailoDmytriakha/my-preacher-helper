import type { RecordingDraft, RecordingDraftContext } from '@/utils/recordingDraftStore';

/** A created study may still own its exact raw sources under the temporary ID after a failed move. */
export function recordingMatchesDestination(draft: RecordingDraft, context?: RecordingDraftContext, contextId?: string, linkedSourceIds: readonly string[] = []): boolean {
  return (context === undefined || draft.context === context)
    && (contextId === undefined || draft.contextId === contextId
      || (context === 'study' && draft.contextId === 'new' && linkedSourceIds.includes(draft.id)));
}
