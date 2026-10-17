'use client';

import { useRef, useState } from 'react';
import { toast } from 'sonner';

import { actionFailureMessage } from '@/utils/actionFailureMessage';

import type { CouncilFinishUndo } from '@/hooks/useCouncilDataDocument';
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

/** Both screens share capture, duplicate-tap protection, feedback and the optional route handoff. */
export function useCouncilFinishAction(t: TFunction, capture: () => Promise<CouncilFinishUndo>, options?: {
  onCaptured?: () => void;
  held?: boolean;
}) {
  const pending = useRef(false);
  const [phase, setPhase] = useState<'idle' | 'saving' | 'failed'>('idle');
  const report = (error: unknown) => { toast.error(actionFailureMessage(error, t, 'council.save.refused')); };
  const finish = async () => {
    if (pending.current) return;
    pending.current = true;
    setPhase('saving');
    try {
      const undo = await capture();
      let undoPending = false;
      showCouncilFinishUndo(t, () => {
        if (undoPending) return;
        undoPending = true;
        void undo().catch(report).finally(() => { undoPending = false; });
      });
      if (options?.onCaptured) options.onCaptured();
      else setPhase('idle');
    } catch (error) {
      setPhase('failed');
      report(error);
    } finally {
      pending.current = false;
    }
  };
  return { finish, finishing: phase === 'saving', showHeld: Boolean(options?.held && phase === 'idle') };
}
