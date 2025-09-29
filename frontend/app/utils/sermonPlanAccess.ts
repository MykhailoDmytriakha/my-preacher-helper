import { Sermon } from '@/models/models';

const hasStructure = (sermon: Sermon): boolean => {
  if (!sermon.structure) {
    return false;
  }

  const { introduction, main, conclusion } = sermon.structure;
  return Boolean(
    introduction?.length ||
      main?.length ||
      conclusion?.length
  );
};

const hasPlan = (sermon: Sermon): boolean => {
  if (!sermon.plan) {
    return false;
  }

  const { introduction, main, conclusion } = sermon.plan;
  return Boolean(
    introduction?.outline ||
      main?.outline ||
      conclusion?.outline
  );
};

const allThoughtsAssigned = (sermon: Sermon): boolean => {
  if (!sermon.thoughts) {
    return false;
  }

  return sermon.thoughts.every((thought) => Boolean(thought.outlinePointId));
};

/**
 * Determines if a sermon is ready for plan access
 * A sermon is considered "prepared" if it has structure or plan
 */
export function isSermonReadyForPlan(sermon: Sermon): boolean {
  return hasStructure(sermon) || hasPlan(sermon);
}

/**
 * Gets the access type for a sermon (plan or structure)
 * Returns the specific type of access available
 */
export function getSermonAccessType(sermon: Sermon): 'plan' | 'structure' | null {
  const planReady = hasPlan(sermon);
  const structureReady = hasStructure(sermon);
  const thoughtsReady = allThoughtsAssigned(sermon);

  if (planReady && thoughtsReady) {
    return 'plan';
  }

  if (planReady || structureReady) {
    return 'structure';
  }

  return null;
}

/**
 * Gets the preferred plan access route for a sermon
 * Prioritizes plan over structure if both exist and thoughts are assigned
 */
export function getSermonPlanAccessRoute(sermonId: string, sermon: Sermon): string {
  const planReady = hasPlan(sermon);
  const structureReady = hasStructure(sermon);
  const thoughtsReady = allThoughtsAssigned(sermon);

  if (planReady && thoughtsReady) {
    return `/sermons/${sermonId}/plan`;
  }

  if (planReady || structureReady) {
    return `/structure?sermonId=${sermonId}`;
  }

  return `/sermons/${sermonId}/plan`;
}
