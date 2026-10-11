import { renderHook } from '@testing-library/react';

import { useSermonCoreDataDocument } from '@/(pages)/(private)/sermons/[id]/hooks/useSermonCoreDataDocument';

import type { DocumentData } from '@/data-engine/types';

const mockDocument = {
  data: null as DocumentData | null, readOnly: false, confirmed: null, remote: null,
  update: jest.fn(async (_updater: (current: DocumentData | null) => DocumentData | null) => undefined),
  commit: jest.fn(async (_updater: (current: DocumentData | null) => DocumentData | null) => undefined),
};
jest.mock('@/data-engine/react.client', () => ({
  useDataEngine: () => ({ owner: 'u1' }),
  useDataDocument: () => mockDocument,
  useDataForm: () => ({ active: false, busy: false, data: null, begin: jest.fn(), cancel: jest.fn(), update: jest.fn(), save: jest.fn() }),
}));
jest.mock('@/components/navigation/shellTitles', () => ({ usePublishShellTitle: jest.fn() }));

/**
 * Typing in the exegetical plan edits the open document (BUG-20261010-exegetical-plan-save-wipes-newer-words):
 * the change goes into the document's draft — its autosave, the save on hiding and the hand-over on
 * leaving deliver it — and it applies to the newest preparation the document holds.
 */
describe('useSermonCoreDataDocument editPreparation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockDocument.data = { userId: 'u1', title: 'T', preparation: { thesis: { homiletical: 'Rendered thesis' } } };
    mockDocument.readOnly = false;
  });

  it("edits the draft, not a save of its own, and keeps the newest preparation's other fields", async () => {
    const { result } = renderHook(() => useSermonCoreDataDocument('s1'));
    await result.current.editPreparation(prep => ({ ...prep, exegeticalPlan: [{ id: 'n1', title: 'Point', children: [] }] }));

    expect(mockDocument.commit).not.toHaveBeenCalled();
    const [updater] = mockDocument.update.mock.calls[0];
    expect(updater({ userId: 'u1', title: 'T', preparation: { thesis: { homiletical: 'Newer thesis' } } })).toEqual({
      userId: 'u1', title: 'T',
      preparation: { thesis: { homiletical: 'Newer thesis' }, exegeticalPlan: [{ id: 'n1', title: 'Point', children: [] }] },
    });
  });

  it("refuses a document that is someone else's or open for reading only", async () => {
    const { result, rerender } = renderHook(() => useSermonCoreDataDocument('s1'));
    await result.current.editPreparation(prep => prep);
    const [updater] = mockDocument.update.mock.calls[0];
    expect(() => updater({ userId: 'u2', preparation: {} })).toThrow('not available for editing');

    mockDocument.readOnly = true;
    rerender();
    await expect(result.current.editPreparation(prep => prep)).rejects.toThrow('not available for editing');
    expect(mockDocument.update).toHaveBeenCalledTimes(1);
  });
});
