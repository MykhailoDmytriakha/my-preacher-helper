import { projectCouncilPrivateFields, readPrivateCouncilReview } from './councilPrivateFields';
import { projectGroupTextDecisions, readPrivateGroupTextReview } from './groupTextReview';

import type { FieldSelection } from './privateFieldReview';
import type { SessionCheckpoint } from './session';

export function readPrivateDocumentReview(checkpoint: SessionCheckpoint) {
  const group = readPrivateGroupTextReview(checkpoint);
  if (group) return { ...group, project: (decisions: readonly FieldSelection[]) => projectGroupTextDecisions(group, decisions) };
  const council = readPrivateCouncilReview(checkpoint);
  return council && { ...council, project: (decisions: readonly FieldSelection[]) => projectCouncilPrivateFields(council, decisions) };
}
