import { act, renderHook, waitFor } from '@testing-library/react';

import { useScratchNotes } from '../useScratchNotes';

import type { ScratchNote, Sermon } from '@/models/models';
import type { MutableRefObject } from 'react';

jest.mock('@/services/scratch.service', () => ({
  addScratchNote: jest.fn(),
  updateScratchNote: jest.fn(),
  deleteScratchNote: jest.fn(),
}));

jest.mock('@/services/sermons.client', () => ({
  applyScratchToOutlineViaClient: jest.fn(),
}));

jest.mock('@/utils/clientId', () => ({
  newClientId: () => 'scratch-client-id',
}));

const scratchServiceMocks = () =>
  jest.requireMock('@/services/scratch.service') as {
    addScratchNote: jest.Mock;
    updateScratchNote: jest.Mock;
    deleteScratchNote: jest.Mock;
  };

const sermonsClientMocks = () =>
  jest.requireMock('@/services/sermons.client') as {
    applyScratchToOutlineViaClient: jest.Mock;
  };

describe('useScratchNotes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    scratchServiceMocks().addScratchNote.mockResolvedValue([]);
    scratchServiceMocks().updateScratchNote.mockResolvedValue([]);
    scratchServiceMocks().deleteScratchNote.mockResolvedValue([]);
    sermonsClientMocks().applyScratchToOutlineViaClient.mockResolvedValue({
      outline: { introduction: [], main: [], conclusion: [] },
      scratch: [],
    });
    Object.defineProperty(navigator, 'onLine', {
      configurable: true,
      value: true,
    });
  });

  it('increments scratch revision and reports pending writes while local scratch persistence is in flight', async () => {
    let resolvePersist: (scratch: ScratchNote[]) => void = () => undefined;
    const persistPromise = new Promise<ScratchNote[]>((resolve) => {
      resolvePersist = resolve;
    });
    scratchServiceMocks().addScratchNote.mockReturnValueOnce(persistPromise);

    let currentSermon: Sermon | null = {
      id: 'sermon-1',
      title: 'Test sermon',
      verse: 'John 3:16',
      date: '2026-07-04',
      userId: 'user-1',
      thoughts: [],
      scratch: [],
    };
    const sermonRef = { current: currentSermon } as MutableRefObject<Sermon | null>;
    const setSermon = jest.fn((updater: Sermon | null | ((previous: Sermon | null) => Sermon | null)) => {
      currentSermon = typeof updater === 'function' ? updater(currentSermon) : updater;
      sermonRef.current = currentSermon;
    });

    const { result } = renderHook(() =>
      useScratchNotes({
        sermon: currentSermon,
        sermonRef,
        setSermon,
      })
    );

    act(() => {
      result.current.addScratchNote('  capture this idea  ');
    });

    await waitFor(() => expect(result.current.isWritePending).toBe(true));
    expect(result.current.scratchRevision).toBe(1);
    expect(sermonRef.current?.scratch).toEqual([
      expect.objectContaining({
        id: 'scratch-client-id',
        text: 'capture this idea',
      }),
    ]);
    expect(scratchServiceMocks().addScratchNote).toHaveBeenCalledWith(
      'sermon-1',
      expect.arrayContaining([
        expect.objectContaining({
          id: 'scratch-client-id',
          text: 'capture this idea',
        }),
      ])
    );

    await act(async () => {
      resolvePersist([]);
      await persistPromise;
    });

    await waitFor(() => expect(result.current.isWritePending).toBe(false));
  });

  it('restores a deleted scratch note through the optimistic add persistence path', async () => {
    let resolvePersist: (scratch: ScratchNote[]) => void = () => undefined;
    const persistPromise = new Promise<ScratchNote[]>((resolve) => {
      resolvePersist = resolve;
    });
    scratchServiceMocks().addScratchNote.mockReturnValueOnce(persistPromise);

    const restoredNote: ScratchNote = {
      id: 'deleted-note',
      text: 'Restore this note',
      createdAt: '2026-07-05T00:00:00.000Z',
      section: 'main',
    };
    let currentSermon: Sermon | null = {
      id: 'sermon-1',
      title: 'Test sermon',
      verse: 'John 3:16',
      date: '2026-07-04',
      userId: 'user-1',
      thoughts: [],
      scratch: [],
    };
    const sermonRef = { current: currentSermon } as MutableRefObject<Sermon | null>;
    const setSermon = jest.fn((updater: Sermon | null | ((previous: Sermon | null) => Sermon | null)) => {
      currentSermon = typeof updater === 'function' ? updater(currentSermon) : updater;
      sermonRef.current = currentSermon;
    });

    const { result } = renderHook(() =>
      useScratchNotes({
        sermon: currentSermon,
        sermonRef,
        setSermon,
      })
    );

    act(() => {
      result.current.restoreScratchNote(restoredNote);
    });

    await waitFor(() => expect(result.current.isWritePending).toBe(true));
    expect(sermonRef.current?.scratch).toEqual([restoredNote]);
    expect(scratchServiceMocks().addScratchNote).toHaveBeenCalledWith('sermon-1', [restoredNote]);

    await act(async () => {
      resolvePersist([restoredNote]);
      await persistPromise;
    });

    await waitFor(() => expect(result.current.isWritePending).toBe(false));
  });

  it('does not leave scratch writes pending while offline when Firestore persistence never settles', async () => {
    Object.defineProperty(navigator, 'onLine', {
      configurable: true,
      value: false,
    });
    scratchServiceMocks().addScratchNote.mockReturnValueOnce(new Promise(() => undefined));

    let currentSermon: Sermon | null = {
      id: 'sermon-1',
      title: 'Test sermon',
      verse: 'John 3:16',
      date: '2026-07-04',
      userId: 'user-1',
      thoughts: [],
      scratch: [],
    };
    const sermonRef = { current: currentSermon } as MutableRefObject<Sermon | null>;
    const setSermon = jest.fn((updater: Sermon | null | ((previous: Sermon | null) => Sermon | null)) => {
      currentSermon = typeof updater === 'function' ? updater(currentSermon) : updater;
      sermonRef.current = currentSermon;
    });

    const { result } = renderHook(() =>
      useScratchNotes({
        sermon: currentSermon,
        sermonRef,
        setSermon,
      })
    );

    act(() => {
      result.current.addScratchNote('offline idea');
    });

    await waitFor(() =>
      expect(sermonRef.current?.scratch).toEqual([
        expect.objectContaining({
          id: 'scratch-client-id',
          text: 'offline idea',
        }),
      ])
    );
    expect(result.current.isWritePending).toBe(false);
    expect(scratchServiceMocks().addScratchNote).toHaveBeenCalledWith(
      'sermon-1',
      expect.arrayContaining([expect.objectContaining({ text: 'offline idea' })])
    );
  });

  it('preserves a voice note added while queued Apply persistence is still in flight', async () => {
    let resolveApply: (value: unknown) => void = () => undefined;
    const applyPromise = new Promise((resolve) => {
      resolveApply = resolve;
    });
    sermonsClientMocks().applyScratchToOutlineViaClient.mockReturnValueOnce(applyPromise);
    const consumedNote: ScratchNote = {
      id: 'consumed-note',
      text: 'Fold me into the outline',
      createdAt: '2026-07-05T00:00:00.000Z',
    };
    let currentSermon: Sermon | null = {
      id: 'sermon-1',
      title: 'Test sermon',
      verse: 'John 3:16',
      date: '2026-07-04',
      userId: 'user-1',
      thoughts: [],
      outline: { introduction: [], main: [], conclusion: [] },
      scratch: [consumedNote],
    };
    const appliedOutline = {
      introduction: [],
      main: [{ id: 'outline-main', text: 'Main point', note: consumedNote.text }],
      conclusion: [],
    };
    const sermonRef = { current: currentSermon } as MutableRefObject<Sermon | null>;
    const setSermon = jest.fn((updater: Sermon | null | ((previous: Sermon | null) => Sermon | null)) => {
      currentSermon = typeof updater === 'function' ? updater(currentSermon) : updater;
      sermonRef.current = currentSermon;
    });

    const { result } = renderHook(() =>
      useScratchNotes({
        sermon: currentSermon,
        sermonRef,
        setSermon,
      })
    );

    act(() => {
      result.current.applyOutlineAndConsume(appliedOutline, ['consumed-note']);
      result.current.addScratchNote('  concurrently dictated voice note  ');
    });

    await waitFor(() =>
      expect(sermonsClientMocks().applyScratchToOutlineViaClient).toHaveBeenCalledWith(
        'sermon-1',
        appliedOutline,
        []
      )
    );
    await waitFor(() =>
      expect(sermonRef.current?.scratch).toEqual([
        expect.objectContaining({
          id: 'scratch-client-id',
          text: 'concurrently dictated voice note',
        }),
      ])
    );

    await act(async () => {
      resolveApply({ outline: appliedOutline, scratch: [] });
      await applyPromise;
    });

    expect(sermonRef.current?.scratch).toEqual([
      expect.objectContaining({
        id: 'scratch-client-id',
        text: 'concurrently dictated voice note',
      }),
    ]);
  });

  it('removes consumed scratch notes exactly once from the current scratch at Apply execution time', async () => {
    const consumedNote: ScratchNote = {
      id: 'consumed-note',
      text: 'Fold me once',
      createdAt: '2026-07-05T00:00:00.000Z',
    };
    const keptNote: ScratchNote = {
      id: 'kept-note',
      text: 'Keep me',
      createdAt: '2026-07-05T00:01:00.000Z',
    };
    let currentSermon: Sermon | null = {
      id: 'sermon-1',
      title: 'Test sermon',
      verse: 'John 3:16',
      date: '2026-07-04',
      userId: 'user-1',
      thoughts: [],
      outline: { introduction: [], main: [], conclusion: [] },
      scratch: [consumedNote, keptNote],
    };
    const appliedOutline = {
      introduction: [],
      main: [{ id: 'outline-main', text: 'Main point', note: consumedNote.text }],
      conclusion: [],
    };
    const sermonRef = { current: currentSermon } as MutableRefObject<Sermon | null>;
    const setSermon = jest.fn((updater: Sermon | null | ((previous: Sermon | null) => Sermon | null)) => {
      currentSermon = typeof updater === 'function' ? updater(currentSermon) : updater;
      sermonRef.current = currentSermon;
    });

    const { result } = renderHook(() =>
      useScratchNotes({
        sermon: currentSermon,
        sermonRef,
        setSermon,
      })
    );

    act(() => {
      result.current.applyOutlineAndConsume(appliedOutline, [
        'consumed-note',
        'consumed-note',
        'missing-note',
      ]);
    });

    await waitFor(() =>
      expect(sermonsClientMocks().applyScratchToOutlineViaClient).toHaveBeenCalledWith(
        'sermon-1',
        appliedOutline,
        [keptNote]
      )
    );
    expect(sermonRef.current?.scratch).toEqual([keptNote]);
  });

  it('rolls back a failed online Apply outline without clobbering a concurrently added voice note', async () => {
    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    let rejectApply: (error: Error) => void = () => undefined;
    const applyPromise = new Promise((_resolve, reject) => {
      rejectApply = reject;
    });
    sermonsClientMocks().applyScratchToOutlineViaClient.mockReturnValueOnce(applyPromise);
    const previousOutline = {
      introduction: [],
      main: [{ id: 'previous-main', text: 'Previous main point' }],
      conclusion: [],
    };
    const consumedNote: ScratchNote = {
      id: 'consumed-note',
      text: 'Fold me into the outline',
      createdAt: '2026-07-05T00:00:00.000Z',
    };
    let currentSermon: Sermon | null = {
      id: 'sermon-1',
      title: 'Test sermon',
      verse: 'John 3:16',
      date: '2026-07-04',
      userId: 'user-1',
      thoughts: [],
      outline: previousOutline,
      scratch: [consumedNote],
    };
    const appliedOutline = {
      introduction: [],
      main: [{ id: 'applied-main', text: 'Applied main point', note: consumedNote.text }],
      conclusion: [],
    };
    const sermonRef = { current: currentSermon } as MutableRefObject<Sermon | null>;
    const setSermon = jest.fn((updater: Sermon | null | ((previous: Sermon | null) => Sermon | null)) => {
      currentSermon = typeof updater === 'function' ? updater(currentSermon) : updater;
      sermonRef.current = currentSermon;
    });

    const { result } = renderHook(() =>
      useScratchNotes({
        sermon: currentSermon,
        sermonRef,
        setSermon,
      })
    );

    act(() => {
      result.current.applyOutlineAndConsume(appliedOutline, ['consumed-note']);
      result.current.addScratchNote('dictated after apply started');
    });

    await waitFor(() => expect(sermonRef.current?.outline).toEqual(appliedOutline));
    await waitFor(() =>
      expect(sermonRef.current?.scratch).toEqual([
        expect.objectContaining({
          id: 'scratch-client-id',
          text: 'dictated after apply started',
        }),
      ])
    );

    await act(async () => {
      rejectApply(new Error('permission denied'));
      await applyPromise.catch(() => undefined);
    });

    await waitFor(() => expect(sermonRef.current?.outline).toEqual(previousOutline));
    expect(sermonRef.current?.scratch).toEqual([
      expect.objectContaining({
        id: 'scratch-client-id',
        text: 'dictated after apply started',
      }),
      consumedNote,
    ]);
    consoleErrorSpy.mockRestore();
  });
});
