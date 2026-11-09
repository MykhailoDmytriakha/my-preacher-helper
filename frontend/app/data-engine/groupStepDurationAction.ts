import { GROUP_STEP_TITLE_POLICY } from './groupFlowTitleAction';
import { alignOptionalRowField } from './rowFieldAction';

import type { RowDetailPolicy } from './rowDetailAction';
import type { RowFieldTarget } from './rowFieldAction';
import type { DataCommand, ResourceSnapshot } from './types';

const DURATION: RowFieldTarget<number | null> = {
  field: 'flow', leaf: 'durationMin', missing: null, storeNull: true,
  accepts: (value): value is number | null => value === null || (typeof value === 'number' && Number.isFinite(value) && value >= 0),
};

export const GROUP_STEP_DURATION_POLICY: RowDetailPolicy<'durationMin', number | null> = {
  collection: 'groups', fields: ['durationMin'], birth: GROUP_STEP_TITLE_POLICY.birth,
  target: () => DURATION,
  proofs: 'groupStepDurationProofs', actions: 'groupStepDurationActions', history: '_stepDurationHistory',
  repeatedFields: ['durationMin'], allowUnclocked: true, allowUnchanged: () => true,
};

/** An absent legacy duration and an explicitly cleared duration both mean no limit. */
export function alignGroupStepDurationRepresentation(command: DataCommand, current: ResourceSnapshot): DataCommand {
  if (command.kind !== 'update' || command.resource.collection !== 'groups' || !Array.isArray(command.groupStepDurationActions)) return command;
  return command.groupStepDurationActions.reduce<DataCommand>((aligned, action) =>
    aligned.kind === 'update' ? alignOptionalRowField(aligned, current, DURATION, action?.rowId) : aligned, command);
}
