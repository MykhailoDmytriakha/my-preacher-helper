import { createEnginePlanWriter } from '@/(pages)/(private)/sermons/[id]/plan/useEnginePlanWriter';
import { isStaleWriteError } from '@/services/conflictSafeUpdate.client';
import { planTextConflictValues } from '@/services/sermons.client';

import { readField } from '@/data-engine/fieldValues';

import type { DocumentData } from '@/data-engine/types';

function draft(initial: DocumentData) {
  const state = { current: initial as DocumentData | null, edits: 0 };
  const update = async (updater: (current: DocumentData | null) => DocumentData | null) => {
    state.edits += 1;
    state.current = updater(state.current);
  };
  const document = { update, commit: update, save: jest.fn().mockResolvedValue(undefined), captureSermonPlanMode: () => ({
    time: null, seen: { sermonId: 's1', generation: 'g', revision: 1, value: readField(state.current ?? {}, ['planMode']) },
  }) };
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

  it('removes only the chosen sub-point and detaches its thought in the same edit', async () => {
    const sibling = { id: 'sibling', text: 'New sibling title', position: 2000 };
    const target = { id: 'target', text: 'Remove this child', position: 1000 };
    const other = { id: 'other', text: 'Other point' };
    const point = { id: 'parent', text: 'New parent title', subPoints: [target, sibling] };
    const attached = { id: 'linked', outlinePointId: 'parent', subPointId: 'target' };
    const unrelated = { id: 'keep', outlinePointId: 'parent', subPointId: 'sibling' };
    const { state, writer } = draft({
      ...sermon({ parent: 'Already transferred text', target: '' }),
      outline: { introduction: [], main: [other], conclusion: [point] },
      thoughts: [attached, unrelated],
    });
    await expect(writer.removeSubPoint('s1', 'parent', 'target')).resolves.toMatchObject({ kind: 'removed' });
    expect(state.current?.outline).toEqual({
      introduction: [], main: [other], conclusion: [{ ...point, subPoints: [sibling] }],
    });
    expect(state.current?.thoughts).toEqual([{ ...attached, subPointId: null }, unrelated]);
    expect(state.current?.planText).toEqual({ parent: 'Already transferred text', target: '' });
  });

  it('leaves a child alone if it moved to a different parent before removal', async () => {
    const outline = { introduction: [{ id: 'old-parent', text: 'Original parent' }], conclusion: [],
      main: [{ id: 'new-parent', text: 'New parent', subPoints: [{ id: 'target', text: 'Moved child', position: 1000 }] }] };
    const { state, writer } = draft({ ...sermon({ target: 'Moved words' }), outline });
    await expect(writer.removeSubPoint('s1', 'old-parent', 'target')).resolves.toMatchObject({ kind: 'absent' });
    expect(state.current).toMatchObject({ outline, planText: { target: 'Moved words' } });
  });

  it('removes cells of deleted plan points and saves the chosen mode', async () => {
    const { state, writer } = draft(sermon({ n1: 'Keep', gone: 'Removed point' }));
    await writer.savePlanText('s1', {}, ['gone']);
    await writer.savePlanMode('s1', 'manual');
    expect(state.current!.planText).toEqual({ n1: 'Keep' });
    expect(state.current!.planMode).toBe('manual');
  });
});
