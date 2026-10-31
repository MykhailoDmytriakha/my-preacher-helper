import { renderHook } from '@testing-library/react';

import { useDataCollection } from '@/data-engine/react.client';
import { sermonNamesNote, useEngineSermonsBuiltOnNote } from '@/hooks/useSermonNoteLinks';

/* The sermons built on a note, read from the engine's list the Bible reads its badges from (phase 7, case 1). */
jest.mock('@/data-engine/react.client', () => ({ ...jest.requireActual('@/data-engine/react.client'), useDataCollection: jest.fn() }));
jest.mock('@/hooks/useResolvedUid', () => ({ useResolvedUid: () => ({ uid: 'owner', isAuthLoading: false }) }));

const row = (id: string, value: Record<string, unknown>, deleting = false) => ({ resource: { collection: 'sermons', id }, value, deleting });

describe('the sermons built on a note, from the engine', () => {
  it('names the owner\'s sermons that link the note, newest first — none deleted here, none of another person', () => {
    jest.mocked(useDataCollection).mockReturnValue({ state: { documents: [
      row('old', { userId: 'owner', title: 'Old', date: '2026-09-01', sourceNoteIds: ['a1'] }),
      row('new', { userId: 'owner', title: 'New', date: '2026-10-30', sourceNoteIds: ['x', 'a1'] }),
      row('other-note', { userId: 'owner', title: 'Other', date: '2026-10-29', sourceNoteIds: ['x'] }),
      row('gone', { userId: 'owner', title: 'Gone', date: '2026-10-31', sourceNoteIds: ['a1'] }, true),
      row('theirs', { userId: 'someone', title: 'Theirs', date: '2026-10-31', sourceNoteIds: ['a1'] }),
    ] } } as unknown as ReturnType<typeof useDataCollection>);
    const { result } = renderHook(() => useEngineSermonsBuiltOnNote('a1'));
    expect(result.current.map((sermon) => sermon.id)).toEqual(['new', 'old']);
    expect(useDataCollection).toHaveBeenCalledWith('sermons');
  });

  it('watches nothing without a note', () => {
    jest.mocked(useDataCollection).mockReturnValue({ state: null } as unknown as ReturnType<typeof useDataCollection>);
    const { result } = renderHook(() => useEngineSermonsBuiltOnNote(null));
    expect(result.current).toEqual([]);
    expect(useDataCollection).toHaveBeenLastCalledWith(null);
  });

  it('reads the link from its one stored fact', () => {
    expect(sermonNamesNote({ sourceNoteIds: ['a1'] }, 'a1')).toBe(true);
    expect(sermonNamesNote({}, 'a1')).toBe(false);
  });
});
