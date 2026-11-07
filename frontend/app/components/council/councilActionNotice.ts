'use client';

import { useRef, useState } from 'react';
import { toast } from 'sonner';

import { showUndoNotice } from '@/components/ui/showUndoNotice';
import { actionFailureMessage } from '@/utils/actionFailureMessage';

import type { CouncilFinishUndo } from '@/hooks/useCouncilDataDocument';
import type { TFunction } from 'i18next';

/** Local capture prepares a carry; the common engine status owns delivery confirmation. */
export function showCouncilCarryPrepared(t: TFunction, title: string, onOpen: () => void) {
  return toast.message(t('council.topic.carryPrepared', { title }), {
    action: { label: title, onClick: onOpen },
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
      showUndoNotice({
        kind: 'message',
        message: t('council.detail.finishUndoAvailable'),
        duration: 8000,
        label: t('council.detail.undo'),
        saving: t('dataSync.phase.savingLocally'),
        onUndo: undo,
        failureMessage: error => actionFailureMessage(error, t, 'council.save.refused'),
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
