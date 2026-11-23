'use client';

import { clearDraftStorageRefusal, draftKey, readDraft, retireDraftCapture, saveDraft } from '@/utils/durableDraft';

import type { PlanCellEmergencyAddress, PlanCellEmergencyStorage } from './planCellEmergency';

const keyOf = ({ owner, sermonId, nodeId, writerId }: PlanCellEmergencyAddress) =>
  draftKey(owner, sermonId, `plan:${nodeId}`, writerId);

export const localPlanCellEmergencyStorage: PlanCellEmergencyStorage = {
  write: (address, text, renew) => {
    const key = keyOf(address);
    if (!saveDraft(key, text, undefined, renew ? 'renew' : true)) return;
    const backup = readDraft<string>(key);
    if (!backup || backup.value !== text) return;
    return { key, proof: backup.captureToken ?? backup };
  },
  clearRefusal: (address, text) => clearDraftStorageRefusal(keyOf(address), text),
  retire: ({ key, proof }, text) => retireDraftCapture(key, proof, text),
};
