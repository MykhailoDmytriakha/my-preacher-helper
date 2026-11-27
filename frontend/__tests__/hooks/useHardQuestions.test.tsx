import { act, renderHook } from '@testing-library/react';

import { useHardQuestions } from '@/hooks/useHardQuestions';

/**
 * The hook is the section's one door to the engine: what is checked here is WHAT it writes —
 * the document, its fields, where a question lands — not only that it wrote (a green test on a
 * mocked hook proves nothing unless its arguments are read).
 */
type Row = { resource: { collection: string; id: string }; value: Record<string, unknown> | null; deleting?: boolean };
let mockRows: Record<string, Row[]> = {};
const mockCreateHardQuestionWithGroup = jest.fn((_resource: unknown, _value: unknown, _group: unknown) => Promise.resolve());
const mockCreate = jest.fn((_resource: unknown, _value: unknown) => Promise.resolve());
const mockRemove = jest.fn((_resource: unknown) => Promise.resolve());
const mockCommit = jest.fn((_resource: unknown, _updater: (current: Record<string, unknown> | null) => unknown, _action?: unknown) => Promise.resolve());
let mockIds = 0;
let mockThemesComplete = true;

jest.mock('@/providers/AuthProvider', () => ({ useAuth: () => ({ user: { uid: 'pastor' } }) }));
jest.mock('@/utils/clientId', () => ({ newClientId: () => `new-${++mockIds}` }));
jest.mock('@/data-engine/react.client', () => ({
  isLiveCollectionDocument: (row: Row) => Boolean(row.value) && !row.deleting,
  useDataCollection: (collection: string | null) => ({
    loading: false,
    state: collection ? { documents: mockRows[collection] ?? [], complete: collection === 'hardQuestionThemes' ? mockThemesComplete : true } : null,
  }),
  useDocumentActions: () => ({ ready: true, create: mockCreate, createHardQuestionWithGroup: mockCreateHardQuestionWithGroup, remove: mockRemove, commit: mockCommit, captureActionTime: () => ({ earliestMs: 100, latestMs: 110 }) }),
}));

const theme = (id: string, rank: number, extra: Record<string, unknown> = {}): Row => ({
  resource: { collection: 'hardQuestionThemes', id },
  value: { userId: 'pastor', title: `Тема ${id}`, rank, createdAt: 'c', updatedAt: 'c', ...extra },
});
const question = (id: string, extra: Record<string, unknown> = {}): Row => ({
  resource: { collection: 'hardQuestions', id },
  value: { userId: 'pastor', title: `Вопрос ${id}`, rank: 1000, short: 'Ответ.', createdAt: 'c', updatedAt: 'c', ...extra },
});

/** What a one-shot commit makes of the stored document. */
const applied = (call: number, current: Record<string, unknown> | null) => mockCommit.mock.calls[call][1](current);

beforeEach(() => {
  mockIds = 0;
  mockThemesComplete = true;
  // Reset, not cleared: a one-time answer a test set and did not use must not leak into the next test.
  mockCreateHardQuestionWithGroup.mockClear();
  mockCreate.mockClear(); mockRemove.mockClear(); mockCommit.mockReset().mockImplementation(() => Promise.resolve());
  mockRows = {
    hardQuestionThemes: [
      theme('clothes', 1000, { groups: [{ id: 'g1', title: 'Длина' }, { id: 'g2', title: 'В церкви' }], bases: [{ id: 'b1', title: 'Мерило' }] }),
      theme('suffering', 2000),
    ],
    hardQuestions: [
      question('q1', { themeId: 'clothes', groupId: 'g1', rank: 1000, basisIds: ['b1'] }),
      question('q2', { themeId: 'clothes', groupId: 'g1', rank: 2000 }),
      question('gone', { themeId: 'clothes', rank: 500 }),
    ],
  };
  mockRows.hardQuestions.push({ ...question('deleting'), deleting: true });
});

describe('useHardQuestions', () => {
  it('reads both collections into one library and leaves out a question being deleted', () => {
    const { result } = renderHook(() => useHardQuestions());
    expect(result.current.library.themes.map((view) => view.theme.id)).toEqual(['clothes', 'suffering']);
    expect(result.current.library.questionById.has('deleting')).toBe(false);
    expect(result.current.complete).toBe(true);
  });

  it('creates a question at the end of its group, trimmed, with nothing about who asked', async () => {
    const { result } = renderHook(() => useHardQuestions());
    await act(async () => { await result.current.createQuestion({ title: '  Можно ли шорты?  ', themeId: 'clothes', groupId: 'g1' }); });
    expect(mockCreateHardQuestionWithGroup).toHaveBeenCalledWith({ collection: 'hardQuestions', id: 'new-1' }, {
      userId: 'pastor', title: 'Можно ли шорты?', themeId: 'clothes', groupId: 'g1', rank: 3000, createdAt: expect.any(String), updatedAt: expect.any(String),
    }, undefined);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('keeps the theme the screen chose even before the list holds it, and refuses empty words', async () => {
    // A theme page can show its theme from the theme's own document while the list is still reading it;
    // a question added there must not land «без темы» (Codex review, round 2).
    const { result } = renderHook(() => useHardQuestions());
    await act(async () => { await result.current.createQuestion({ title: 'Вопрос из новой темы', themeId: 'not-listed-yet', groupId: 'g9' }); });
    expect(mockCreateHardQuestionWithGroup).toHaveBeenCalledWith(expect.anything(),
      expect.objectContaining({ themeId: 'not-listed-yet', groupId: 'g9' }), undefined);
    await expect(result.current.createQuestion({ title: '   ' })).rejects.toThrow();
  });

  it('plans two quick moves from the same real order, not from a list that has not caught up', async () => {
    const { result } = renderHook(() => useHardQuestions());
    // q1 (1000), q2 (2000) in g1; the list does not re-render between the presses.
    await act(async () => { await result.current.moveQuestion('q2', -1); });
    await act(async () => { await result.current.moveQuestion('q2', 1); });
    const ranks = mockCommit.mock.calls.map(([, updater]) => (updater({ title: 'x', rank: 0 }) as { rank: number }).rank);
    expect(ranks).toEqual([0, 2000]); // up before q1 (1000), then back down just past it — counted from the moved rank, not the stale list
  });

  it('lets a refused rank go, so the next arrow is planned over the order the list really has', async () => {
    const { result } = renderHook(() => useHardQuestions());
    mockCommit.mockImplementationOnce(() => Promise.reject(new Error('refused')));
    await act(async () => { await expect(result.current.moveQuestion('q2', -1)).rejects.toThrow('refused'); });
    // q2 still stands second (2000): «up» again is a real move, not the edge of a list that never was.
    await act(async () => { await result.current.moveQuestion('q2', -1); });
    expect(mockCommit).toHaveBeenCalledTimes(2);
    expect(applied(1, { title: 'Вопрос q2', rank: 2000 })).toMatchObject({ rank: 0 });
  });

  it('refuses to move a question whose theme is not read yet, instead of planning it among the questions without a theme', async () => {
    mockThemesComplete = false;
    mockRows.hardQuestions.push(question('early', { themeId: 'not-read-yet', rank: 100 }));
    const { result } = renderHook(() => useHardQuestions());
    await act(async () => { await expect(result.current.moveQuestion('early', 1)).rejects.toThrow('not read yet'); });
    expect(mockCommit).not.toHaveBeenCalled();
  });

  it('creates a theme after the last one', async () => {
    const { result } = renderHook(() => useHardQuestions());
    await act(async () => { await result.current.createTheme({ title: 'Брак', intro: ' ' }); });
    expect(mockCreate).toHaveBeenCalledWith({ collection: 'hardQuestionThemes', id: 'new-1' }, expect.objectContaining({ title: 'Брак', rank: 3000 }));
    expect(mockCreate.mock.calls[0][1]).not.toHaveProperty('intro');
    // Empty lists from the start: two devices adding a first group append to one common list.
    expect(mockCreate.mock.calls[0][1]).toMatchObject({ groups: [], bases: [] });
  });

  it('moves a question by its rank alone, one document, and does nothing at the edge', async () => {
    const { result } = renderHook(() => useHardQuestions());
    await act(async () => { await result.current.moveQuestion('q2', -1); });
    expect(mockCommit).toHaveBeenCalledTimes(1);
    expect(mockCommit.mock.calls[0][0]).toEqual({ collection: 'hardQuestions', id: 'q2' });
    expect(applied(0, { title: 'Вопрос q2', rank: 2000 })).toMatchObject({ title: 'Вопрос q2', rank: 0 }); // before q1 (1000): one step below it
    // q2 now stands first (its new rank is counted although the list has not re-rendered): up again is the edge.
    await act(async () => { await result.current.moveQuestion('q2', -1); });
    expect(mockCommit).toHaveBeenCalledTimes(1);
  });

  it('moving a question to another theme drops the bases of the old one; to another group of the same theme keeps them', async () => {
    const { result } = renderHook(() => useHardQuestions());
    await act(async () => { await result.current.placeQuestion('q1', 'suffering', undefined); });
    const moved = applied(0, { title: 'q', themeId: 'clothes', groupId: 'g1', basisIds: ['b1'], rank: 1000 }) as Record<string, unknown>;
    expect(moved).toMatchObject({ themeId: 'suffering', rank: 1000 });
    expect(moved).not.toHaveProperty('groupId');
    expect(moved).not.toHaveProperty('basisIds');
    await act(async () => { await result.current.placeQuestion('q1', 'clothes', 'g2'); });
    expect(applied(1, { title: 'q', themeId: 'clothes', groupId: 'g1', basisIds: ['b1'] })).toMatchObject({ groupId: 'g2', basisIds: ['b1'] });
  });

  it('judges the bases by the theme the question is stored in, not by a list that shows an older copy (Codex 2026-11-27)', async () => {
    const { result } = renderHook(() => useHardQuestions());
    // The list still shows q1 in «clothes»; the stored question already stands in «suffering» with a basis of it.
    await act(async () => { await result.current.placeQuestion('q1', 'suffering', undefined); });
    expect(applied(0, { title: 'q', themeId: 'suffering', basisIds: ['s1'], rank: 1000 })).toMatchObject({ themeId: 'suffering', basisIds: ['s1'] });
  });

  it('refuses a move made on a picture no longer true: the question is stored meanwhile in a third theme (Codex 2026-11-27)', async () => {
    const { result } = renderHook(() => useHardQuestions());
    // Seen in «clothes», moved to another group of «clothes»; stored meanwhile in «suffering» with a basis of it.
    await act(async () => { await result.current.placeQuestion('q1', 'clothes', 'g2', 'clothes'); });
    expect(() => applied(0, { title: 'q', themeId: 'suffering', basisIds: ['s1'], rank: 1000 })).toThrow();
  });

  it('refuses a move into a theme gone meanwhile, instead of taking the question out of every theme', async () => {
    const { result } = renderHook(() => useHardQuestions());
    await act(async () => { await expect(result.current.placeQuestion('q1', 'removed-theme', undefined)).rejects.toThrow(); });
    expect(mockCommit).not.toHaveBeenCalled();
  });

  it('refuses to replace a selected missing group with no group', async () => {
    const { result } = renderHook(() => useHardQuestions());
    await act(async () => { await expect(result.current.placeQuestion('q1', 'clothes', 'removed-group')).rejects.toThrow(); });
    expect(mockCommit).not.toHaveBeenCalled();
  });

  it('passes the exact displayed place and revision to the queued move', async () => {
    const { result } = renderHook(() => useHardQuestions());
    const opening = { place: { themeId: 'clothes', groupId: 'g1', rank: 1000 }, observedRevision: 3 };
    await act(async () => { await result.current.placeQuestion('q1', 'clothes', 'g2', opening); });
    expect(mockCommit.mock.calls[0][2]).toMatchObject({
      kind: 'document-metadata', time: { earliestMs: 100, latestMs: 110 }, hardQuestionPlacementOpening: opening,
    });
  });

  it('refuses to change a question deleted meanwhile, instead of writing it back', async () => {
    const { result } = renderHook(() => useHardQuestions());
    await act(async () => { await result.current.moveQuestion('q2', -1); });
    expect(() => applied(0, null)).toThrow('HARD_QUESTION_GONE');
  });

  it('removes a theme and only the theme: its questions stay in the section, without a theme', async () => {
    const { result } = renderHook(() => useHardQuestions());
    await act(async () => { await result.current.removeTheme('clothes'); });
    expect(mockRemove.mock.calls.map(([resource]) => resource)).toEqual([{ collection: 'hardQuestionThemes', id: 'clothes' }]);
  });

  it('changes groups and bases inside the theme document, the rest of it untouched', async () => {
    const { result } = renderHook(() => useHardQuestions());
    const stored = { title: 'Одежда', groups: [{ id: 'g1', title: 'Длина' }, { id: 'g2', title: 'В церкви' }], bases: [{ id: 'b1', title: 'Мерило' }], rank: 1000 };
    await act(async () => { await result.current.addGroup('clothes', ' Украшения '); });
    expect(applied(0, stored)).toMatchObject({ title: 'Одежда', groups: [...stored.groups, { id: 'new-1', title: 'Украшения' }], bases: stored.bases });
    await act(async () => { await result.current.removeGroup('clothes', 'g1'); });
    expect((applied(1, stored) as { groups: unknown }).groups).toEqual([{ id: 'g2', title: 'В церкви' }]);
    await act(async () => { await result.current.moveGroup('clothes', 'g2', -1); });
    expect((applied(2, stored) as { groups: { id: string }[] }).groups.map((group) => group.id)).toEqual(['g2', 'g1']);
    await act(async () => { await result.current.saveBasis('clothes', { id: 'b1', title: 'Мерило — стыдливость', scriptureRefs: ['1 Тим 2:9', ''] }); });
    expect((applied(3, stored) as { bases: unknown }).bases).toEqual([{ id: 'b1', title: 'Мерило — стыдливость', scriptureRefs: ['1 Тим 2:9'] }]);
    await act(async () => { await result.current.removeBasis('clothes', 'b1'); });
    expect((applied(4, stored) as { bases: unknown }).bases).toEqual([]);
  });

  it('a change to one group or basis leaves every other entry whole, with fields this version does not read (Codex 2026-11-27)', async () => {
    const { result } = renderHook(() => useHardQuestions());
    const stored = {
      title: 'Одежда', rank: 1000,
      groups: [{ id: 'g1', title: 'Длина', note: 'later field' }, { id: 'g2', title: 'В церкви' }],
      bases: [{ id: 'b1', title: 'Мерило', label: 'стыдливость', extra: 7, scriptureRefs: ['1 Тим 2:9'] }, { id: 'b2', title: 'Обычай', scriptureRefs: ['Рим 12:2'] }],
    };
    await act(async () => { await result.current.removeBasis('clothes', 'b2'); });
    expect((applied(0, stored) as { bases: unknown }).bases).toEqual([stored.bases[0]]);
    await act(async () => { await result.current.moveGroup('clothes', 'g2', -1); });
    expect((applied(1, stored) as { groups: unknown }).groups).toEqual([stored.groups[1], stored.groups[0]]);
    await act(async () => { await result.current.renameGroup('clothes', 'g2', 'В церкви и дома'); });
    expect((applied(2, stored) as { groups: unknown }).groups).toEqual([stored.groups[0], { id: 'g2', title: 'В церкви и дома' }]);
    // The basis edited keeps what it holds beyond the form; its old short label goes (removed 2026-11-26).
    await act(async () => { await result.current.saveBasis('clothes', { id: 'b1', title: 'Мерило — стыдливость', scriptureRefs: ['1 Тим 2:9–10'] }); });
    expect((applied(3, stored) as { bases: unknown }).bases).toEqual([
      { id: 'b1', title: 'Мерило — стыдливость', extra: 7, scriptureRefs: ['1 Тим 2:9–10'] }, stored.bases[1],
    ]);
  });

  it('does not keep a basis whose list names no place a Bible can open — words or a chapter the book lacks', async () => {
    const { result } = renderHook(() => useHardQuestions());
    await act(async () => {
      await expect(result.current.saveBasis('clothes', { title: 'Мерило', scriptureRefs: ['Рим 25', 'стыдливость'] })).rejects.toThrow('place of Scripture');
    });
    expect(mockCommit).not.toHaveBeenCalled();
  });

  it('does not keep a basis with no place of Scripture: it refuses before writing (the owner, 2026-11-26)', async () => {
    const { result } = renderHook(() => useHardQuestions());
    await act(async () => {
      await expect(result.current.saveBasis('clothes', { title: 'Мерило', scriptureRefs: [' ', ''] })).rejects.toThrow('place of Scripture');
    });
    expect(mockCommit).not.toHaveBeenCalled();
  });

  it('a new group named like one the theme has is that group: its id comes back and nothing is written', async () => {
    const { result } = renderHook(() => useHardQuestions());
    let id = '';
    await act(async () => { id = await result.current.addGroup('clothes', '  в  ЦЕРКВИ '); });
    expect(id).toBe('g2');
    expect(mockCommit).not.toHaveBeenCalled();
  });

  it('a repeat of the add finds its own group already there and adds nothing twice', async () => {
    const { result } = renderHook(() => useHardQuestions());
    let id = '';
    await act(async () => { id = await result.current.addGroup('clothes', 'Украшения'); });
    const stored = { title: 'Одежда', groups: [{ id: 'g1', title: 'Длина' }, { id, title: 'Украшения' }] };
    expect((applied(0, stored) as { groups: unknown }).groups).toEqual(stored.groups);
  });

  it('captures the question and its new group as one action', async () => {
    const { result } = renderHook(() => useHardQuestions());
    await act(async () => { await result.current.createQuestion({ title: 'Серьги?', themeId: 'clothes', newGroupTitle: ' Украшения ' }); });
    expect(mockCreateHardQuestionWithGroup).toHaveBeenCalledWith({ collection: 'hardQuestions', id: 'new-1' },
      expect.objectContaining({ themeId: 'clothes', groupId: 'new-2', title: 'Серьги?' }),
      { group: { id: 'new-2', title: 'Украшения' } });
    expect(mockCommit).not.toHaveBeenCalled();
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('a question «into a new group» named like an existing one goes into that group, no twin made', async () => {
    const { result } = renderHook(() => useHardQuestions());
    await act(async () => { await result.current.createQuestion({ title: 'Макси?', themeId: 'clothes', newGroupTitle: 'длина' }); });
    expect(mockCommit).not.toHaveBeenCalled();
    expect(mockCreateHardQuestionWithGroup).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ groupId: 'g1' }),
      undefined);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('writes no question when its new group cannot be made, and makes no group for a question without a theme', async () => {
    mockCreateHardQuestionWithGroup.mockImplementationOnce(() => Promise.reject(new Error('theme gone')));
    const { result } = renderHook(() => useHardQuestions());
    await act(async () => {
      await expect(result.current.createQuestion({ title: 'Серьги?', themeId: 'clothes', newGroupTitle: 'Украшения' })).rejects.toThrow('theme gone');
    });
    expect(mockCreate).not.toHaveBeenCalled();
    await act(async () => { await result.current.createQuestion({ title: 'Без темы', newGroupTitle: 'Украшения' }); });
    expect(mockCreateHardQuestionWithGroup).toHaveBeenCalledTimes(1);
    expect(mockCommit).not.toHaveBeenCalled();
    expect(mockCreate.mock.calls[0][1]).not.toHaveProperty('groupId');
  });

  it('queues changes to one document one after another', async () => {
    let release!: () => void;
    mockCommit.mockImplementationOnce(() => new Promise<void>((resolve) => { release = resolve; }));
    const { result } = renderHook(() => useHardQuestions());
    let first!: Promise<unknown>;
    let second!: Promise<unknown>;
    act(() => { first = result.current.addGroup('clothes', 'A'); second = result.current.addGroup('clothes', 'B'); });
    await act(async () => { await Promise.resolve(); });
    expect(mockCommit).toHaveBeenCalledTimes(1);
    await act(async () => { release(); await first; await second; });
    expect(mockCommit).toHaveBeenCalledTimes(2);
  });
});
