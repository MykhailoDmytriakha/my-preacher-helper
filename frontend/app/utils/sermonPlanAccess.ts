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
 * Defaults to 'structure' for new sermons without data
 */
export function getSermonAccessType(sermon: Sermon): 'plan' | 'structure' {
  const planReady = hasPlan(sermon);
  const structureReady = hasStructure(sermon);
  const thoughtsReady = allThoughtsAssigned(sermon);

  if (planReady && thoughtsReady) {
    return 'plan';
  }

  return 'structure';
}

/**
 * Checks if a sermon has a complete plan ready for preaching
 * A plan is considered ready for preaching if it has content in all sections
 */
export function isSermonReadyForPreaching(sermon: Sermon): boolean {
  if (!sermon.plan) {
    return false;
  }

  const { introduction, main, conclusion } = sermon.plan;

  // Check if all sections have meaningful content (not just empty strings)
  const hasIntroContent = Boolean(introduction?.outline?.trim().length);
  const hasMainContent = Boolean(main?.outline?.trim().length);
  const hasConclusionContent = Boolean(conclusion?.outline?.trim().length);

  return hasIntroContent && hasMainContent && hasConclusionContent;
}

/**
 * Gets the preferred plan access route for a sermon
 * Prioritizes plan over structure if both exist and thoughts are assigned
 * Defaults to structure page for new sermons
 */
export function getSermonPlanAccessRoute(sermonId: string, sermon: Sermon): string {
  const planReady = hasPlan(sermon);
  const thoughtsReady = allThoughtsAssigned(sermon);

  if (planReady && thoughtsReady) {
    return `/sermons/${sermonId}/plan`;
  }

  return `/sermons/${sermonId}/structure`;
}
