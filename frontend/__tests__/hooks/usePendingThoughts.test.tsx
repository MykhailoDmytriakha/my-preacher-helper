import React from 'react';
import { renderHook, act, waitFor } from '@testing-library/react';

import { usePendingThoughts } from '@/(pages)/(private)/sermons/[id]/structure/hooks/usePendingThoughts';
import { buildLocalThoughtId, loadPendingThoughts, savePendingThoughts } from '@/utils/pendingThoughtsStore';
import { toast } from 'sonner';

import type { Sermon, Item } from '@/models/models';
import type { PendingThoughtRecord } from '@/utils/pendingThoughtsStore';

jest.mock('@/utils/pendingThoughtsStore', () => {
  const actual = jest.requireActual('@/utils/pendingThoughtsStore');
  return {
    ...actual,
    buildLocalThoughtId: jest.fn(),
    loadPendingThoughts: jest.fn(),
    savePendingThoughts: jest.fn(),
  };
});

jest.mock('sonner', () => ({
  toast: {
    error: jest.fn(),
  },
}));

const allowedTags = [
  { name: 'introduction', color: '#111111' },
  { name: 'main', color: '#222222' },
  { name: 'conclusion', color: '#333333' },
  { name: 'ambiguous', color: '#444444' },
];

const baseSermon: Sermon = {
  id: 'sermon-1',
  title: 'Test Sermon',
  verse: 'John 3:16',
  date: '2023-01-01',
  thoughts: [],
  userId: 'user-1',
  outline: {
    introduction: [{ id: 'p1', text: 'Intro point' }],
    main: [{ id: 'p2', text: 'Main point' }],
    conclusion: [{ id: 'p3', text: 'Conclusion point' }],
  },
  structure: {
    introduction: [],
    main: [],
    conclusion: [],
    ambiguous: [],
  },
};

const emptyContainers: Record<string, Item[]> = {
  introduction: [],
  main: [],
  conclusion: [],
  ambiguous: [],
};

const setupHook = (options?: {
  sermonId?: string | null;
  sermon?: Sermon | null;
  containers?: Record<string, Item[]>;
}) => {
  const sermonId = options?.sermonId ?? 'sermon-1';
  const sermon = options?.sermon ?? baseSermon;
  const initialContainers = options?.containers ?? emptyContainers;

  return renderHook(() => {
    const [containers, setContainers] = React.useState<Record<string, Item[]>>(initialContainers);
    const containersRef = React.useRef<Record<string, Item[]>>(containers);

    React.useEffect(() => {
      containersRef.current = containers;
    }, [containers]);

    const hook = usePendingThoughts({
      sermonId,
      sermon,
      allowedTags,
      setContainers,
      containersRef,
      containers,
    });

    return {
      ...hook,
      containers,
    };
  });
};

describe('usePendingThoughts', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (loadPendingThoughts as jest.Mock).mockResolvedValue([]);
    (savePendingThoughts as jest.Mock).mockResolvedValue(undefined);
    (buildLocalThoughtId as jest.Mock).mockReturnValue('local-1');
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('loads pending thoughts, normalizes sending status, and hydrates containers', async () => {
    const pending: PendingThoughtRecord = {
      localId: 'local-1',
      sermonId: 'sermon-1',
      sectionId: 'introduction',
      text: 'Pending intro',
      tags: [],
      outlinePointId: 'p1',
      createdAt: '2023-01-01T00:00:00.000Z',
      lastAttemptAt: '2023-01-01T00:00:00.000Z',
      expiresAt: '2023-01-01T01:00:00.000Z',
      status: 'sending',
    };

    (loadPendingThoughts as jest.Mock).mockResolvedValue([pending]);

    const { result } = setupHook();

    await waitFor(() => expect(result.current.pendingThoughts).toHaveLength(1));

    expect(result.current.pendingThoughts[0].status).toBe('error');
    expect(savePendingThoughts).toHaveBeenCalledWith('sermon-1', expect.any(Array));
    expect(result.current.containers.introduction.map((item) => item.id)).toEqual(['local-1']);
    expect(result.current.containers.introduction[0].syncStatus).toBe('error');
  });

  it('creates pending thought and inserts after outline group end while removing from other sections', () => {
    const initialContainers: Record<string, Item[]> = {
      introduction: [
        { id: 't1', content: 'First', outlinePointId: 'p1' },
        { id: 't2', content: 'Second', outlinePointId: 'p2' },
      ],
      main: [{ id: 'local-1', content: 'Stale', outlinePointId: 'p1' }],
      conclusion: [],
      ambiguous: [],
    };

    const { result } = setupHook({ containers: initialContainers });

    act(() => {
      result.current.createPendingThought({
        sectionId: 'introduction',
        text: 'New thought',
        tags: [],
        outlinePointId: 'p1',
      });
    });

    expect(result.current.pendingThoughts).toHaveLength(1);
    expect(result.current.containers.introduction.map((item) => item.id)).toEqual(['t1', 'local-1', 't2']);
    expect(result.current.containers.main.find((item) => item.id === 'local-1')).toBeUndefined();
  });

  it('updates pending status and sync fields, then clears sync metadata', () => {
    const { result } = setupHook();

    act(() => {
      result.current.createPendingThought({
        sectionId: 'main',
        text: 'Main thought',
        tags: [],
        outlinePointId: 'p2',
      });
    });

    act(() => {
      result.current.markPendingStatus('local-1', 'sending', { error: 'network' });
    });

    expect(result.current.pendingThoughts[0].status).toBe('sending');
    const mainItem = result.current.containers.main.find((item) => item.id === 'local-1');
    expect(mainItem?.syncStatus).toBe('pending');
    expect(mainItem?.syncLastError).toBe('network');

    act(() => {
      result.current.updateItemSyncStatus('local-1', 'success', { successAt: '2023-01-02T00:00:00.000Z' });
    });

    const updatedItem = result.current.containers.main.find((item) => item.id === 'local-1');
    expect(updatedItem?.syncStatus).toBe('success');
    expect(updatedItem?.syncSuccessAt).toBe('2023-01-02T00:00:00.000Z');

    act(() => {
      result.current.updateItemSyncStatus('local-1');
    });

    const clearedItem = result.current.containers.main.find((item) => item.id === 'local-1');
    expect(clearedItem?.syncStatus).toBeUndefined();
    expect(clearedItem?.syncSuccessAt).toBeUndefined();
  });

  it('removes pending thoughts from state and containers', () => {
    const { result } = setupHook();

    act(() => {
      result.current.createPendingThought({
        sectionId: 'conclusion',
        text: 'Conclusion thought',
        tags: [],
        outlinePointId: 'p3',
      });
    });

    act(() => {
      result.current.removePendingThought('local-1');
    });

    expect(result.current.pendingThoughts).toHaveLength(0);
    expect(result.current.containers.conclusion).toHaveLength(0);
  });

  it('expires pending thoughts and shows toast', async () => {
    jest.useFakeTimers();

    const expired: PendingThoughtRecord = {
      localId: 'local-1',
      sermonId: 'sermon-1',
      sectionId: 'introduction',
      text: 'Expired thought',
      tags: [],
      outlinePointId: 'p1',
      createdAt: '2023-01-01T00:00:00.000Z',
      lastAttemptAt: '2023-01-01T00:00:00.000Z',
      expiresAt: '2023-01-01T00:00:00.000Z',
      status: 'pending',
    };

    (loadPendingThoughts as jest.Mock).mockResolvedValue([expired]);

    const { result } = setupHook();

    await waitFor(() => expect(result.current.pendingThoughts).toHaveLength(1));

    act(() => {
      jest.advanceTimersByTime(1000);
    });

    await waitFor(() => expect(result.current.pendingThoughts).toHaveLength(0));
    expect(toast.error).toHaveBeenCalled();

    jest.useRealTimers();
  });
});
