import { useResolvedUid } from '@/hooks/useResolvedUid';
import { useServerFirstQuery } from '@/hooks/useServerFirstQuery';
import { StudyNoteBranchState } from '@/models/models';
import { getStudyNoteBranchStates } from '@services/studies.service';

export const studyNoteBranchStatesKey = (uid: string | undefined) => ['study-note-branch-states', uid];

export function useStudyNoteBranchStates({ enabled = true }: { enabled?: boolean } = {}) {
  const { uid, isAuthLoading } = useResolvedUid();

  const branchStatesQuery = useServerFirstQuery({
    queryKey: studyNoteBranchStatesKey(uid),
    queryFn: () => (uid ? getStudyNoteBranchStates(uid) : Promise.resolve([])),
    enabled: Boolean(enabled) && !!uid,
  });

  return {
    uid,
    branchStates: (branchStatesQuery.data ?? []) as StudyNoteBranchState[],
    loading: isAuthLoading || branchStatesQuery.isLoading,
    error: branchStatesQuery.error as Error | null,
    refetch: branchStatesQuery.refetch,
  };
}
