import { isGroupBlockStatus } from '@/utils/groupDocument';

import { GROUP_BLOCK_TITLE_POLICY } from './groupFlowTitleAction';

import type { RowDetailPolicy } from './rowDetailAction';
import type { GroupBlockStatus } from '@/models/models';

export const GROUP_BLOCK_STATUS_POLICY: RowDetailPolicy<'status', GroupBlockStatus> = {
  collection: 'groups', fields: ['status'], birth: GROUP_BLOCK_TITLE_POLICY.birth,
  target: () => ({ field: 'templates', leaf: 'status', accepts: isGroupBlockStatus }),
  proofs: 'groupBlockStatusProofs', actions: 'groupBlockStatusActions', history: '_blockStatusHistory',
  repeatedFields: ['status'], allowUnclocked: true, allowUnchanged: () => true,
};
