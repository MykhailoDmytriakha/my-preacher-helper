'use client';

import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { DataSyncStatus } from '@/data-engine/DataSyncStatus';

import type { BookMarksStore } from './markStore';

/** The phases of the book's form that wait for the person's choice: no stroke is kept until it is made. */
const DECISION_PHASES = ['conflict', 'refused', 'deleted', 'localFailure', 'blocked'];

/**
 * WHETHER A STROKE CAN BE KEPT NOW, AND WHY NOT — one rule for every screen that keeps marks: the reader
 * (`useReaderMarks`) and an analysis opened away from it (`analysis/useAnalysisBookMarks.ts`). A stroke starts only when
 * it can be kept: while the book's form cannot write (the device's storage silent for seconds after an iPad wakes) the
 * person is told to wait instead of being shown a stroke that would be lost; while the form waits for a choice (marks
 * changed on two devices) the person is told to choose first, and `status` is where the choice is made. A choice runs for
 * a moment: no stroke until it has, or the choice would sweep the stroke away with the draft it replaces.
 */
export function useMarksWriteGate({ writable, sync }: Pick<BookMarksStore, 'writable' | 'sync'>, statusClassName: string) {
  const { t } = useTranslation();
  const [deciding, setDeciding] = useState(false);
  const writableRef = useRef(writable && !deciding);
  writableRef.current = writable && !deciding;
  const decisionRef = useRef(false);
  decisionRef.current = deciding || DECISION_PHASES.includes(sync?.status?.phase ?? '');
  const waitSaid = useRef(0);
  const sayWhy = useCallback(() => {
    if (Date.now() - waitSaid.current <= 4_000) return;
    waitSaid.current = Date.now();
    toast(t(decisionRef.current ? 'bible.marks.decideFirst' : 'bible.marks.wait'));
  }, [t]);
  // Refused strokes say so themselves (a toast); the status shows only what waits for a choice.
  const status = useMemo<ReactNode>(() => (sync ? (
    <DataSyncStatus subject={sync.recoveryIdentity} status={sync.status} error={sync.state ? null : sync.error} errorWords={sync.errorWords} className={statusClassName}
      onRetry={() => sync.retry()}
      onKeepLocal={() => { setDeciding(true); return sync.keepLocal().finally(() => setDeciding(false)); }}
      onAcceptRemote={() => { setDeciding(true); return sync.acceptRemote().finally(() => setDeciding(false)); }} />
  ) : null), [statusClassName, sync]);
  return { writableRef, sayWhy, status };
}
