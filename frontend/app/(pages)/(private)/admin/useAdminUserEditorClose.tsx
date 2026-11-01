'use client';

import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';

import { useDiscardQuestion } from '@/hooks/useConfirm';

interface EditorFields {
  targetUid: string;
  paidTier: string;
  role: string;
  promotionMode: 'unchanged' | 'set' | 'clear';
  promotionTier: string;
  promotionExpiresAt: string;
  aiUsage: string;
  transcriptionSeconds: string;
  audioSeconds: string;
}

const signatureOf = (fields: EditorFields): string => JSON.stringify([
  fields.targetUid, fields.paidTier, fields.role, fields.promotionMode,
  fields.promotionMode === 'set' ? fields.promotionTier : '',
  fields.promotionMode === 'set' ? fields.promotionExpiresAt : '',
  fields.aiUsage, fields.transcriptionSeconds, fields.audioSeconds,
]);

type Checkpoint = Readonly<{ session: number; signature: string }>;

/** One opening owns its starting values, close question and accepted submission checkpoint. */
export function useAdminUserEditorClose({ open, busy, fields, onClose }: {
  open: boolean; busy: boolean; fields: EditorFields; onClose: () => void;
}) {
  const { askBeforeDiscard, discardDialog, withdraw } = useDiscardQuestion();
  const signature = signatureOf(fields);
  const baseline = useRef(signature);
  const session = useRef(0);
  const live = useRef({ open: false, busy, signature, onClose });

  useLayoutEffect(() => {
    if (open && !live.current.open) {
      session.current += 1;
      baseline.current = signature;
    }
    live.current = { open, busy, signature, onClose };
  }, [open, busy, signature, onClose]);

  useEffect(() => { if (!open) withdraw(); }, [open, withdraw]);

  const requestClose = useCallback(() => {
    const shown = live.current;
    if (!shown.open || shown.busy) return;
    const opening = session.current;
    void askBeforeDiscard(shown.signature !== baseline.current, shown.onClose, () =>
      live.current.open && !live.current.busy && session.current === opening
        && live.current.signature === shown.signature);
  }, [askBeforeDiscard]);

  const captureSubmission = useCallback((): Checkpoint => ({
    session: session.current, signature: live.current.signature,
  }), []);
  const confirmSaved = useCallback((checkpoint: Checkpoint) => {
    if (live.current.open && session.current === checkpoint.session) baseline.current = checkpoint.signature;
  }, []);

  return { requestClose, captureSubmission, confirmSaved, discardDialog };
}
