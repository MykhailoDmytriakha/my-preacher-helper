import { projectCouncilPrivateFields, readPrivateCouncilReview } from './councilPrivateFields';
import { projectGroupTextDecisions, readPrivateGroupTextReview } from './groupTextReview';

import type { SessionCheckpoint } from './session';

export function readPrivateDocumentReview(checkpoint: SessionCheckpoint) {
  const group = readPrivateGroupTextReview(checkpoint);
  if (group) return { ...group, project: (decisions: Parameters<typeof projectGroupTextDecisions>[1]) => projectGroupTextDecisions(group, decisions) };
  const council = readPrivateCouncilReview(checkpoint);
  return council && { ...council, project: (decisions: Parameters<typeof projectCouncilPrivateFields>[1]) => projectCouncilPrivateFields(council, decisions) };
}
