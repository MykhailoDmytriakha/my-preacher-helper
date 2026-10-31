'use client';

import { useCallback, useEffect, useRef } from 'react';

import { useConfirm } from '@/hooks/useConfirm';

/** Only an explicit choice may leave an opening whose first local capture is unconfirmed. */
export function useAnalysisDeparture({ unkept, subject }: { unkept: boolean; subject: object }) {
  const { confirm, confirmDialog, withdraw } = useConfirm();
  const current = useRef(subject);
  current.current = subject;
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  // A new account/opening and a newly kept capture each make the old question obsolete.
  useEffect(() => { withdraw(); }, [subject, withdraw]);
  useEffect(() => { if (!unkept) withdraw(); }, [unkept, withdraw]);

  const requestDeparture = useCallback(async (leave: () => void) => {
    const expected = subject;
    const isCurrent = () => mounted.current && current.current === expected;
    if (!isCurrent()) return;
    if (unkept && !(await confirm({
      title: { key: 'analysis.leaveUnkept.title' },
      description: { key: 'analysis.leaveUnkept.description' },
      confirmText: { key: 'analysis.leaveUnkept.leave' },
      cancelText: { key: 'analysis.leaveUnkept.stay' },
      destructive: false,
    }))) return;
    if (isCurrent()) leave();
  }, [confirm, subject, unkept]);

  return { requestDeparture, departureDialog: confirmDialog };
}
