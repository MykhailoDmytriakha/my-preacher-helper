import { createEnginePlanWriter } from '@/(pages)/(private)/sermons/[id]/plan/useEnginePlanWriter';
import { isStaleWriteError } from '@/services/conflictSafeUpdate.client';
import { planTextConflictValues } from '@/services/sermons.client';

import type { DocumentData } from '@/data-engine/types';

function draft(initial: DocumentData) {
  const state = { current: initial as DocumentData | null, edits: 0 };
  const document = { update: async (updater: (current: DocumentData | null) => DocumentData | null) => { state.edits += 1; state.current = updater(state.current); } };
  return { state, writer: createEnginePlanWriter(document, 'owner-1') };
}
const sermon = (planText: Record<string, string>) => ({
  userId: 'owner-1', title: 'Grace', verse: 'John 1:14', date: '2026-09-01', thoughts: [], planText,
}) as unknown as DocumentData;

describe('plan writes on an engine document', () => {
  it('writes a cell nobody else touched since this screen took it', async () => {
    const { state, writer } = draft(sermon({ n1: 'Old intro', n2: 'Body' }));
    await writer.savePlanText('s1', { n1: 'New intro' }, [], { baselineByNodeId: { n1: 'Old intro' } });
    expect(state.current!.planText).toEqual({ n1: 'New intro', n2: 'Body' });
  });

  it('refuses a cell rewritten on another device and reports its current text, leaving the draft alone', async () => {
    const { state, writer } = draft(sermon({ n1: 'Rewritten on the phone' }));
    const refusal = await writer.savePlanText('s1', { n1: 'Laptop text' }, [], { baselineByNodeId: { n1: 'Old intro' } }).catch(error => error);
    expect(isStaleWriteError(refusal)).toBe(true);
    expect(planTextConflictValues(refusal)).toEqual({ n1: 'Rewritten on the phone' });
    expect(state.current!.planText).toEqual({ n1: 'Rewritten on the phone' });
  });

  it('removes cells of deleted plan points and saves the chosen mode', async () => {
    const { state, writer } = draft(sermon({ n1: 'Keep', gone: 'Removed point' }));
    await writer.savePlanText('s1', {}, ['gone']);
    await writer.savePlanMode('s1', 'manual');
    expect(state.current!.planText).toEqual({ n1: 'Keep' });
    expect(state.current!.planMode).toBe('manual');
  });
});
