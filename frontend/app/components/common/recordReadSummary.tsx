'use client';

import { createContext, useContext, type ReactNode } from 'react';

import type { FailureWords } from '@/utils/actionFailureMessage';

export interface RecordReadNotice { subject: unknown; words?: FailureWords }
const Context = createContext<RecordReadNotice | null>(null);

/** Claim only this record's rendered read summary; other subjects and refusals keep their notices. */
export function RecordReadSummary({ notice, children }: { notice?: RecordReadNotice; children: ReactNode }) {
  return <Context.Provider value={notice ?? null}>{children}</Context.Provider>;
}
export function useRecordReadSummary(): RecordReadNotice | null { return useContext(Context); }
