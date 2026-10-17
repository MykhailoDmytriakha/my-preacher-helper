'use client';

import { toast } from 'sonner';

import type { TFunction } from 'i18next';

/** Local capture prepares a carry; the common engine status owns delivery confirmation. */
export function showCouncilCarryPrepared(t: TFunction, title: string, onOpen: () => void) {
  return toast.message(t('council.topic.carryPrepared', { title }), {
    action: { label: title, onClick: onOpen },
  });
}

/** Undo remains available before delivery, including while the device is offline. */
export function showCouncilFinishUndo(t: TFunction, onUndo: () => void) {
  return toast.message(t('council.detail.finishUndoAvailable'), {
    // A person needs enough time to reach Undo after finishing or leaving the conduct screen.
    duration: 8000,
    action: { label: t('council.detail.undo'), onClick: onUndo },
  });
}
