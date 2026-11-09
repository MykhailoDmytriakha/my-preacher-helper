import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom';

import StructurePage from '@/(pages)/(private)/sermons/[id]/structure/page';
import { useSermonStructureData } from '@/hooks/useSermonStructureData';
import { getExportContent } from '@/utils/exportContent';
import { mergeOutline } from '@/utils/mergeOutline';
import type { DocumentData } from '@/data-engine/types';
import { toast } from 'sonner';
import { createMockSermon, createMockThought, createMockItem, createMockSermonPoint } from '@test-utils/structure-test-utils';

jest.mock('@/hooks/useSermonStructureData');
const mockEngineWriter = {
  updateStructure: jest.fn().mockResolvedValue({}),
  updateThought: jest.fn(async (_id: string, thought: unknown) => thought),
  setThoughtLocks: jest.fn<Promise<void>, [readonly { id: string; date: string }[], boolean]>().mockResolvedValue(undefined),
  deleteThought: jest.fn().mockResolvedValue(undefined),
  createManualThought: jest.fn(async (_id: string, thought: unknown) => thought),
  updateSermonOutline: jest.fn().mockResolvedValue(null),
};
let mockEngineDocumentData: Record<string, unknown> | null = null;
jest.mock('@/data-engine/react.client', () => ({
  ...jest.requireActual('@/data-engine/react.client'),
  DataDocumentProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useDataEngine: () => ({ owner: 'user-1', browser: null, error: null }),
  useOpenDocumentAnswerScopes: () => [],
}));
jest.mock('@/data-engine/DataSyncStatus', () => ({ DataSyncStatus: () => <div data-testid="engine-sync-status" /> }));
jest.mock('@/(pages)/(private)/sermons/[id]/structure/useEngineStructureWriter', () => ({
  useEngineStructureWriter: (id: string, owner: string) => ({
    recovery: jest.requireActual('@/components/plan-editor/useOutlineConflict').useOutlineConflict(owner, id),
    writer: mockEngineWriter, document: {
    data: mockEngineDocumentData, loading: false, error: null, status: null,
    retry: jest.fn(), keepLocal: jest.fn(), acceptRemote: jest.fn(),
  } }),
}));
// Every write the page makes goes through the engine writer; these are its recording functions.
const updateStructure = mockEngineWriter.updateStructure;
const updateThought = mockEngineWriter.updateThought;
const setThoughtLocks = mockEngineWriter.setThoughtLocks;
const deleteThought = mockEngineWriter.deleteThought;
const updateSermonOutline = mockEngineWriter.updateSermonOutline;
jest.mock('@/utils/exportContent', () => ({
  getExportContent: jest.fn().mockResolvedValue('exported'),
}));

const pushSpy = jest.fn();
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushSpy, prefetch: jest.fn(), replace: jest.fn() }),
  useSearchParams: () => ({ get: jest.fn(() => null) }),
  usePathname: jest.fn().mockReturnValue('/sermons/sermon-1/structure'),
  useParams: jest.fn(() => ({ id: 'sermon-1' })),
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => {
      if (options?.defaultValue) return options.defaultValue as string;
      // A sentence naming a thought carries its text, as the real one does.
      if (typeof options?.text === 'string') return `${key}: ${options.text}`;
      return key;
    },
  }),
}));

jest.mock('sonner', () => ({
  toast: { success: jest.fn(), error: jest.fn(), loading: jest.fn() },
}));

const focusModeState: { focusedColumn: string | null } = { focusedColumn: 'introduction' };
const debouncedSaveThoughtSpy = jest.fn();
const debouncedSaveStructureSpy = jest.fn();
const handleAiSortSpy = jest.fn();
let autoTriggerAiSort = false;
let autoTriggerPointLock = true;
let autoTriggerThoughtLock = false;
let autoTriggerSubPointDelete = false;
let suppressAutomaticColumnHandlers = false;
let addOutlinePointHandler: ((sectionId: string, index: number, text: string) => Promise<void>) | null = null;

jest.mock('@dnd-kit/core', () => {
  const MockDndContext = ({ children, onDragEnd }: any) => {
    React.useEffect(() => {
      onDragEnd?.({ active: { id: 't1' } });
    }, [onDragEnd]);
    return <div data-testid="dnd-context">{children}</div>;
  };
  const MockDragOverlay = ({ children }: any) => <div data-testid="drag-overlay">{children}</div>;
  return {
    DndContext: MockDndContext,
    DragOverlay: MockDragOverlay,
    pointerWithin: jest.fn(),
  };
});

jest.mock('@/(pages)/(private)/sermons/[id]/structure/hooks/useAiSortingDiff', () => ({
  useAiSortingDiff: () => {
    const highlighted = { t1: { type: 'moved' as const } };
    return {
      highlightedItems: highlighted,
      isDiffModeActive: true,
      isSorting: false,
      handleAiSort: handleAiSortSpy,
      handleKeepItem: jest.fn(),
      handleRevertItem: jest.fn(),
      handleKeepAll: jest.fn(),
      handleRevertAll: jest.fn(),
      setHighlightedItems: jest.fn((updater: any) => {
        if (typeof updater === 'function') {
          updater(highlighted);
        }
      }),
      setIsDiffModeActive: jest.fn(),
      setPreSortState: jest.fn(),
    };
  },
}));

jest.mock('@/(pages)/(private)/sermons/[id]/structure/hooks/useFocusMode', () => ({
  useFocusMode: () => {
    const fc = focusModeState.focusedColumn;
    const visible = fc ? [fc] : ['introduction', 'main', 'conclusion'];
    return {
      focusedColumn: fc,
      isFocusMode: visible.length === 1,
      visibleSections: visible,
      isSectionVisible: (id: string) => visible.includes(id),
      toggleSection: jest.fn(),
      soloSection: jest.fn(),
      showAll: jest.fn(),
      handleToggleFocusMode: jest.fn(),
      navigateToSection: jest.fn(),
    };
  },
}));

jest.mock('@/(pages)/(private)/sermons/[id]/structure/hooks/useOutlineStats', () => ({
  useOutlineStats: () => ({ thoughtsPerSermonPoint: {} }),
}));

jest.mock('@/(pages)/(private)/sermons/[id]/structure/hooks/usePersistence', () => ({
  usePersistence: () => ({
    debouncedSaveThought: debouncedSaveThoughtSpy,
    debouncedSaveStructure: debouncedSaveStructureSpy,
  }),
}));

jest.mock('@/(pages)/(private)/sermons/[id]/structure/hooks/useSermonActions', () => ({
  useSermonActions: () => ({
    editingItem: null,
    addingThoughtToSection: null,
    handleEdit: jest.fn(),
    handleCloseEdit: jest.fn(),
    handleAddThoughtToSection: jest.fn(),
    handleSaveEdit: jest.fn(),
    handleDeleteThought: jest.fn(async (id) => {
      await mockEngineWriter.deleteThought('sermon-1', { id });
      await mockEngineWriter.updateStructure('sermon-1', {});
    }),
    handleMoveToAmbiguous: jest.fn(),
    handleRetryPendingThought: jest.fn(),
  }),
}));

jest.mock('@/(pages)/(private)/sermons/[id]/structure/hooks/useStructureDnd', () => ({
  useStructureDnd: () => ({
    sensors: [],
    activeId: 't1',
    handleDragStart: jest.fn(),
    handleDragOver: jest.fn(),
    handleDragEnd: jest.fn(),
  }),
}));

jest.mock('@/components/SortableItem', () => ({
  __esModule: true,
  SortableItemPreview: () => <div data-testid="sortable-item-preview" />,
  default: () => <div data-testid="sortable-item" />,
}));

jest.mock('@/components/ui/ConfirmModal', () => ({
  __esModule: true,
  default: ({ isOpen, title, description, onConfirm, onClose, confirmText, cancelText }: any) =>
    isOpen ? (
      <div data-testid="confirm-modal">
        <div>{title}</div>
        <div>{description}</div>
        <button onClick={onConfirm}>{confirmText || 'Confirm'}</button>
        <button onClick={onClose}>{cancelText || 'Cancel'}</button>
      </div>
    ) : null,
}));

jest.mock('@/components/Column', () => {
  const MockColumn = (props: any) => {
    const clickedPointLock = React.useRef(false);
    React.useEffect(() => {
      addOutlinePointHandler = props.onAddOutlinePoint;
      if (suppressAutomaticColumnHandlers) return;
      props.onSwitchPage?.(props.id);
      props.onAudioThoughtCreated?.({
        id: 'audio-1',
        text: 'Audio thought',
        tags: ['Introduction'],
        date: new Date().toISOString(),
      }, props.id);
      props.onOutlineUpdate?.({
        introduction: [createMockSermonPoint({ id: 'op-1', text: 'Point 1' })],
        main: [],
        conclusion: [],
      });
      props.onOutlinePointDeleted?.('op-1', props.id);
      if (autoTriggerSubPointDelete) {
        props.onSubPointDeleted?.('op-1', 'sp-1', props.id);
      }
      void props.onAddOutlinePoint?.(props.id, 0, 'Inserted point');
      if (autoTriggerPointLock && !clickedPointLock.current) {
        clickedPointLock.current = true;
        void props.onTogglePointLock?.('op-1', true);
      }
      if (autoTriggerThoughtLock) {
        void props.onToggleThoughtLock?.('t1', true);
      }
      if (autoTriggerAiSort) {
        props.onAiSortPoint?.('op-1');
      }
      void props.getExportContent?.('plain', { includeTags: true });
    }, [props]);
    return <div data-testid={`column-${props.id}`} />;
  };

  return {
    __esModule: true,
    default: MockColumn,
  };
});

jest.mock('@/(pages)/(private)/sermons/[id]/structure/components/AmbiguousSection', () => ({
  AmbiguousSection: (props: any) => {
    // Once, like a single click. The delete now asks in an in-app window, and every question
    // re-renders the page: asking on every render would ask forever.
    const asked = React.useRef(false);
    React.useEffect(() => {
      if (asked.current) return;
      asked.current = true;
      props.onDelete?.('amb-1', 'ambiguous');
    }, [props]);
    return <div data-testid="ambiguous-section" />;
  },
}));

describe('StructurePage handlers', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    focusModeState.focusedColumn = 'introduction';
    autoTriggerAiSort = false;
    autoTriggerPointLock = true;
    autoTriggerThoughtLock = false;
    autoTriggerSubPointDelete = false;
    suppressAutomaticColumnHandlers = false;
    addOutlinePointHandler = null;
    localStorage.clear();
  });

  it('executes key handlers for navigation, audio, outline, delete, and drag-end flows', async () => {
    let sermonState = createMockSermon({
      id: 'sermon-1',
      thoughts: [
        createMockThought({ id: 't1', text: 'Intro', tags: ['Introduction'], outlinePointId: 'op-1' }),
        createMockThought({ id: 'amb-1', text: 'Ambiguous', tags: [] }),
      ],
      structure: {
        introduction: ['t1'],
        main: [],
        conclusion: [],
        ambiguous: ['amb-1'],
      },
      outline: {
        introduction: [createMockSermonPoint({ id: 'op-1', text: 'Point 1' })],
        main: [],
        conclusion: [],
      },
    });

    let containersState: Record<string, any[]> = {
      introduction: [createMockItem({ id: 't1', content: 'Intro', outlinePointId: 'op-1' })],
      main: [],
      conclusion: [],
      ambiguous: [createMockItem({ id: 'amb-1', content: 'Ambiguous' })],
    };

    const setSermon = jest.fn((updater: any) => {
      sermonState = typeof updater === 'function' ? updater(sermonState) : updater;
    });
    const setContainers = jest.fn((updater: any) => {
      containersState = typeof updater === 'function' ? updater(containersState) : updater;
    });

    (useSermonStructureData as jest.Mock).mockReturnValue({
      sermon: sermonState,
      setSermon,
      containers: containersState,
      setContainers,
      outlinePoints: sermonState.outline,
      requiredTagColors: { introduction: '#000', main: '#000', conclusion: '#000' },
      allowedTags: [],
      loading: false,
      error: null,
      isAmbiguousVisible: true,
      setIsAmbiguousVisible: jest.fn(),
      syncFromEngine: jest.fn(),
      retry: jest.fn(),
    });

    render(<StructurePage />);

    // The ambiguous thought is only deleted after the person says yes in the app's own window.
    const question = await screen.findByTestId('confirm-modal');
    expect(question).toHaveTextContent('sermon.deleteThoughtConfirm: Ambiguous');
    expect(deleteThought).not.toHaveBeenCalled();
    fireEvent.click(within(question).getByRole('button', { name: 'common.delete' }));

    await waitFor(() => {
      expect(pushSpy).toHaveBeenCalled();
      expect(deleteThought).toHaveBeenCalled();
      expect(setThoughtLocks).toHaveBeenCalled();
      expect(updateSermonOutline).toHaveBeenCalled();
      expect(updateStructure).toHaveBeenCalled();
      expect(getExportContent).toHaveBeenCalled();
      expect(debouncedSaveThoughtSpy).toHaveBeenCalled();
    });
  });

  it('routes AI sorting to the selected outline point in focus mode', async () => {
    autoTriggerAiSort = true;

    const sermon = createMockSermon({
      id: 'sermon-1',
      thoughts: [
        createMockThought({ id: 't1', text: 'Locked intro', tags: ['Introduction'], outlinePointId: 'op-1', isLocked: true }),
      ],
      structure: {
        introduction: ['t1'],
        main: [],
        conclusion: [],
        ambiguous: [],
      },
      outline: {
        introduction: [createMockSermonPoint({ id: 'op-1', text: 'Point 1' })],
        main: [],
        conclusion: [],
      },
    });

    (useSermonStructureData as jest.Mock).mockReturnValue({
      sermon,
      setSermon: jest.fn(),
      containers: {
        introduction: [createMockItem({ id: 't1', content: 'Locked intro', outlinePointId: 'op-1', isLocked: true })],
        main: [],
        conclusion: [],
        ambiguous: [],
      },
      setContainers: jest.fn(),
      outlinePoints: sermon.outline,
      requiredTagColors: { introduction: '#000', main: '#000', conclusion: '#000' },
      allowedTags: [],
      loading: false,
      error: null,
      isAmbiguousVisible: true,
      setIsAmbiguousVisible: jest.fn(),
      syncFromEngine: jest.fn(),
      retry: jest.fn(),
    });

    render(<StructurePage />);

    await waitFor(() => {
      expect(handleAiSortSpy).toHaveBeenCalledWith({
        columnId: 'introduction',
        outlinePointId: 'op-1',
      });
    });
    expect(screen.queryByTestId('confirm-modal')).not.toBeInTheDocument();
  });

  it('locks a single thought through the dedicated thought toggle handler', async () => {
    autoTriggerPointLock = false;
    autoTriggerThoughtLock = true;

    const sermon = createMockSermon({
      id: 'sermon-1',
      thoughts: [
        createMockThought({ id: 't1', text: 'Intro thought', tags: ['Introduction'], outlinePointId: 'op-1', isLocked: false }),
      ],
      structure: {
        introduction: ['t1'],
        main: [],
        conclusion: [],
        ambiguous: [],
      },
      outline: {
        introduction: [createMockSermonPoint({ id: 'op-1', text: 'Point 1' })],
        main: [],
        conclusion: [],
      },
    });

    (useSermonStructureData as jest.Mock).mockReturnValue({
      sermon,
      setSermon: jest.fn(),
      containers: {
        introduction: [createMockItem({ id: 't1', content: 'Intro thought', outlinePointId: 'op-1', isLocked: false })],
        main: [],
        conclusion: [],
        ambiguous: [],
      },
      setContainers: jest.fn(),
      outlinePoints: sermon.outline,
      requiredTagColors: { introduction: '#000', main: '#000', conclusion: '#000' },
      allowedTags: [],
      loading: false,
      error: null,
      isAmbiguousVisible: true,
      setIsAmbiguousVisible: jest.fn(),
      syncFromEngine: jest.fn(),
      retry: jest.fn(),
    });

    render(<StructurePage />);

    await waitFor(() => {
      expect(setThoughtLocks).toHaveBeenCalledWith([expect.objectContaining({ id: 't1', date: sermon.thoughts[0].date })], true);
      expect(updateThought).not.toHaveBeenCalledWith('sermon-1', expect.objectContaining({ isLocked: true }), expect.anything());
    });

    // A lock write is offline-first (`queued`): the server may still refuse it, so
    // this interaction must not announce that it was saved.
    expect(toast.success).not.toHaveBeenCalledWith('Thought locked');
  });

  it('hands the board the engine document and sends a lock through the engine writer', async () => {
    autoTriggerPointLock = false;
    autoTriggerThoughtLock = true;
    const sermon = createMockSermon({
      id: 'sermon-1',
      thoughts: [createMockThought({ id: 't1', text: 'Intro thought', tags: ['Introduction'], outlinePointId: 'op-1', isLocked: false })],
      structure: { introduction: ['t1'], main: [], conclusion: [], ambiguous: [] },
      outline: { introduction: [createMockSermonPoint({ id: 'op-1', text: 'Point 1' })], main: [], conclusion: [] },
    });
    mockEngineDocumentData = { ...sermon, userId: 'user-1' };
    (useSermonStructureData as jest.Mock).mockReturnValue({
      sermon, setSermon: jest.fn(),
      containers: { introduction: [createMockItem({ id: 't1', content: 'Intro thought', outlinePointId: 'op-1', isLocked: false })], main: [], conclusion: [], ambiguous: [] },
      setContainers: jest.fn(), outlinePoints: sermon.outline,
      requiredTagColors: { introduction: '#000', main: '#000', conclusion: '#000' },
      allowedTags: [], loading: false, error: null, isAmbiguousVisible: true, setIsAmbiguousVisible: jest.fn(),
      syncFromEngine: jest.fn(),
      retry: jest.fn(),
    });
    try {
      render(<StructurePage />);
      await waitFor(() => expect(setThoughtLocks).toHaveBeenCalledWith(
        [expect.objectContaining({ id: 't1', date: sermon.thoughts[0].date })], true));
      const engineSource = (useSermonStructureData as jest.Mock).mock.calls.at(-1)![1];
      expect(engineSource.sermon).toEqual(expect.objectContaining({ id: 'sermon-1', userId: 'user-1' }));
      expect(screen.getByTestId('engine-sync-status')).toBeInTheDocument();
    } finally {
      mockEngineDocumentData = null;
    }
  });

  it('locks only the displayed thought identities and keeps current text, placement, and independent locks', async () => {
    const date = '2026-11-08T00:00:00.000Z';
    const first = createMockThought({ id: 't1', date, text: 'Rewritten on the phone' });
    const second = createMockThought({ id: 't2', date, text: 'Another thought', isLocked: true });
    const third = createMockThought({ id: 't3', date, text: 'Untouched thought', isLocked: false });
    const structure = { introduction: ['t1', 't2'], main: ['t3'], conclusion: [], ambiguous: [] };
    let document = createMockSermon({ userId: 'user-1', thoughts: [first, second, third], structure });
    const update = jest.fn(async (updater: (value: DocumentData | null) => DocumentData | null) => {
      document = updater(document as unknown as DocumentData) as unknown as typeof document;
    });
    const { createEngineStructureWriter } = jest.requireActual<typeof import('@/(pages)/(private)/sermons/[id]/structure/useEngineStructureWriter')>(
      '@/(pages)/(private)/sermons/[id]/structure/useEngineStructureWriter');
    const writer = createEngineStructureWriter({ update }, 'user-1');

    await writer.setThoughtLocks([{ id: first.id, date }, { id: second.id, date }], true);
    expect(update).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith(expect.any(Function), { action: { kind: 'thought-lock', rowIds: ['t1', 't2'] } });
    expect(document.thoughts).toEqual([{ ...first, isLocked: true }, second, third]);
    expect(document.structure).toEqual(structure);

    await expect(writer.setThoughtLocks([{ id: 't1', date: 'replaced' }, { id: 't3', date }], true)).rejects.toThrow();
    expect(document.thoughts).toEqual([{ ...first, isLocked: true }, second, third]);
  });

  it('clears sub-point ids when an outline point is deleted', async () => {
    let sermonState = createMockSermon({
      id: 'sermon-1',
      thoughts: [
        createMockThought({ id: 't1', text: 'Intro', tags: ['Introduction'], outlinePointId: 'op-1', subPointId: 'sp-1' }),
      ],
      structure: {
        introduction: ['t1'],
        main: [],
        conclusion: [],
        ambiguous: [],
      },
      outline: {
        introduction: [createMockSermonPoint({ id: 'op-1', text: 'Point 1' })],
        main: [],
        conclusion: [],
      },
    });

    let containersState: Record<string, any[]> = {
      introduction: [createMockItem({ id: 't1', content: 'Intro', outlinePointId: 'op-1', subPointId: 'sp-1' })],
      main: [],
      conclusion: [],
      ambiguous: [],
    };

    const setSermon = jest.fn((updater: any) => {
      sermonState = typeof updater === 'function' ? updater(sermonState) : updater;
    });
    const setContainers = jest.fn((updater: any) => {
      containersState = typeof updater === 'function' ? updater(containersState) : updater;
    });

    (useSermonStructureData as jest.Mock).mockReturnValue({
      sermon: sermonState,
      setSermon,
      containers: containersState,
      setContainers,
      outlinePoints: sermonState.outline,
      requiredTagColors: { introduction: '#000', main: '#000', conclusion: '#000' },
      allowedTags: [],
      loading: false,
      error: null,
      isAmbiguousVisible: true,
      setIsAmbiguousVisible: jest.fn(),
      syncFromEngine: jest.fn(),
      retry: jest.fn(),
    });

    render(<StructurePage />);

    await waitFor(() => {
      expect(debouncedSaveThoughtSpy).toHaveBeenCalledWith(
        'sermon-1',
        expect.objectContaining({
          id: 't1',
          outlinePointId: null,
          subPointId: null,
        }),
        // The opening value travels too: only the plan links change here, so the
        // thought's TEXT must not be re-sent from this screen's snapshot.
        expect.objectContaining({ id: 't1' }),
      );
    });
  });

  it('clears sub-point ids when a sub-point is deleted', async () => {
    autoTriggerSubPointDelete = true;

    let sermonState = createMockSermon({
      id: 'sermon-1',
      thoughts: [
        createMockThought({ id: 't1', text: 'Intro', tags: ['Introduction'], outlinePointId: 'op-1', subPointId: 'sp-1' }),
      ],
      structure: {
        introduction: ['t1'],
        main: [],
        conclusion: [],
        ambiguous: [],
      },
      outline: {
        introduction: [createMockSermonPoint({ id: 'op-1', text: 'Point 1', subPoints: [{ id: 'sp-1', text: 'Sub-point', position: 1000 }] })],
        main: [],
        conclusion: [],
      },
    });

    let containersState: Record<string, any[]> = {
      introduction: [createMockItem({ id: 't1', content: 'Intro', outlinePointId: 'op-1', subPointId: 'sp-1' })],
      main: [],
      conclusion: [],
      ambiguous: [],
    };

    const setSermon = jest.fn((updater: any) => {
      sermonState = typeof updater === 'function' ? updater(sermonState) : updater;
    });
    const setContainers = jest.fn((updater: any) => {
      containersState = typeof updater === 'function' ? updater(containersState) : updater;
    });

    (useSermonStructureData as jest.Mock).mockReturnValue({
      sermon: sermonState,
      setSermon,
      containers: containersState,
      setContainers,
      outlinePoints: sermonState.outline,
      requiredTagColors: { introduction: '#000', main: '#000', conclusion: '#000' },
      allowedTags: [],
      loading: false,
      error: null,
      isAmbiguousVisible: true,
      setIsAmbiguousVisible: jest.fn(),
      syncFromEngine: jest.fn(),
      retry: jest.fn(),
    });

    render(<StructurePage />);

    await waitFor(() => {
      expect(debouncedSaveThoughtSpy).toHaveBeenCalledWith(
        'sermon-1',
        expect.objectContaining({
          id: 't1',
          subPointId: null,
        }),
        expect.objectContaining({ id: 't1' }),
      );
    });
  });

  it('submits the point locks in one write and leaves the displayed copy intact on failure', async () => {
    const date = '2026-11-08T00:00:00.000Z';
    const first = createMockThought({ id: 't1', date, text: 'Intro 1', outlinePointId: 'op-1' });
    const second = createMockThought({ id: 't2', date, text: 'Intro 2', outlinePointId: 'op-1', isLocked: true });
    const sermon = createMockSermon({
      id: 'sermon-1', thoughts: [first, second],
      structure: { introduction: ['t1', 't2'], main: [], conclusion: [], ambiguous: [] },
      outline: { introduction: [createMockSermonPoint({ id: 'op-1', text: 'Point 1' })], main: [], conclusion: [] },
    });
    const containers = { introduction: [createMockItem({ id: 't1' }), createMockItem({ id: 't2', isLocked: true })],
      main: [], conclusion: [], ambiguous: [] };
    setThoughtLocks.mockRejectedValueOnce(new Error('lock failed'));
    (useSermonStructureData as jest.Mock).mockReturnValue({
      sermon, containers, outlinePoints: sermon.outline, setSermon: jest.fn(), setContainers: jest.fn(),
      requiredTagColors: { introduction: '#000', main: '#000', conclusion: '#000' }, allowedTags: [],
      loading: false, error: null, isAmbiguousVisible: true, setIsAmbiguousVisible: jest.fn(),
      syncFromEngine: jest.fn(), retry: jest.fn(),
    });

    render(<StructurePage />);

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Failed to save thought.'));
    expect(setThoughtLocks.mock.calls[0]).toEqual([[first, second], true]);
    expect(setThoughtLocks).toHaveBeenCalledTimes(1);
    expect(sermon.thoughts.map(thought => Boolean(thought.isLocked))).toEqual([false, true]);
  });

  it('toggles vertical layout and persists preference when not in focus mode', async () => {
    focusModeState.focusedColumn = null;
    localStorage.setItem('structureLayoutVertical', 'false');
    const localStorageSetItemSpy = jest.spyOn(Storage.prototype, 'setItem');

    const sermon = createMockSermon({
      id: 'sermon-1',
      thoughts: [],
      structure: { introduction: [], main: [], conclusion: [], ambiguous: [] },
      outline: { introduction: [], main: [], conclusion: [] },
    });

    (useSermonStructureData as jest.Mock).mockReturnValue({
      sermon,
      setSermon: jest.fn(),
      containers: { introduction: [], main: [], conclusion: [], ambiguous: [] },
      setContainers: jest.fn(),
      outlinePoints: sermon.outline,
      requiredTagColors: { introduction: '#000', main: '#000', conclusion: '#000' },
      allowedTags: [],
      loading: false,
      error: null,
      isAmbiguousVisible: true,
      setIsAmbiguousVisible: jest.fn(),
      syncFromEngine: jest.fn(),
      retry: jest.fn(),
    });

    render(<StructurePage />);

    const layoutButton = await screen.findByTestId('layout-toggle-button');
    fireEvent.click(layoutButton);

    expect(localStorageSetItemSpy).toHaveBeenCalledWith('structureLayoutVertical', 'true');
    expect(layoutButton).toHaveTextContent('Horizontal');
  });

  /**
   * ADDING A POINT HERE MUST NOT ERASE A POINT ADDED ON ANOTHER DEVICE.
   *
   * The plan is one whole field, and this page built the save from the sermon it
   * loaded — so everything stored since that load was replaced. The owner's own
   * scenario: a point captured on the phone in the morning, this page open since
   * last night, one point added here in the afternoon, and the morning's point gone
   * with no warning.
   *
   * The assertion is what SURVIVED on the server, not which arguments were passed:
   * a call-shape check stays green even when the merge itself is broken.
   */
  it('keeps a point added on another device when a point is added here', async () => {
    const phonePoint = createMockSermonPoint({ id: 'op-phone', text: 'Added on the phone' });
    const openingPoint = createMockSermonPoint({ id: 'op-1', text: 'Point 1' });

    // What is actually stored: the page never saw the phone's point.
    let serverOutline = {
      introduction: [openingPoint, phonePoint],
      main: [],
      conclusion: [],
    };
    (updateSermonOutline as jest.Mock).mockImplementation(
      async (_sermonId: string, mine: any, base?: any) => {
        if (base === undefined) {
          serverOutline = mine; // whole-field replace — the unguarded path
        } else {
          serverOutline = mergeOutline(base, mine, serverOutline).outline as typeof serverOutline;
        }
        return serverOutline;
      }
    );

    const sermonState = createMockSermon({
      id: 'sermon-1',
      thoughts: [],
      structure: { introduction: [], main: [], conclusion: [], ambiguous: [] },
      outline: { introduction: [openingPoint], main: [], conclusion: [] },
    });

    (useSermonStructureData as jest.Mock).mockReturnValue({
      sermon: sermonState,
      setSermon: jest.fn(),
      containers: { introduction: [], main: [], conclusion: [], ambiguous: [] },
      setContainers: jest.fn(),
      outlinePoints: sermonState.outline,
      requiredTagColors: { introduction: '#000', main: '#000', conclusion: '#000' },
      allowedTags: [],
      loading: false,
      error: null,
      isAmbiguousVisible: true,
      setIsAmbiguousVisible: jest.fn(),
      syncFromEngine: jest.fn(),
      retry: jest.fn(),
    });

    render(<StructurePage />);

    // The stubbed column fires onAddOutlinePoint on render.
    await waitFor(() =>
      expect(serverOutline.introduction.map((point: any) => point.text)).toContain('Inserted point')
    );
    expect(serverOutline.introduction.map((point: any) => point.id)).toContain('op-phone');
  });

  it('keeps a failed newer point when an older outline save lands late and the next save succeeds', async () => {
    suppressAutomaticColumnHandlers = true;
    autoTriggerPointLock = false;
    let timestamp = 1000;
    const dateNowSpy = jest.spyOn(Date, 'now').mockImplementation(() => timestamp++);

    const openingPoint = createMockSermonPoint({ id: 'op-1', text: 'Opening point' });
    let serverOutline = { introduction: [openingPoint], main: [], conclusion: [] };
    let finishFirstSave: (() => void) | null = null;
    let saveNumber = 0;

    (updateSermonOutline as jest.Mock).mockImplementation(
      async (_sermonId: string, mine: typeof serverOutline, base: typeof serverOutline) => {
        saveNumber += 1;
        if (saveNumber === 1) {
          return new Promise<typeof serverOutline>((resolve) => {
            finishFirstSave = () => {
              serverOutline = mergeOutline(base, mine, serverOutline).outline as typeof serverOutline;
              resolve(serverOutline);
            };
          });
        }
        if (saveNumber === 2) {
          throw new Error('newer save failed');
        }
        serverOutline = mergeOutline(base, mine, serverOutline).outline as typeof serverOutline;
        return serverOutline;
      }
    );

    let sermonState = createMockSermon({
      id: 'sermon-1',
      thoughts: [],
      structure: { introduction: [], main: [], conclusion: [], ambiguous: [] },
      outline: serverOutline,
    });
    const setSermon = jest.fn((updater: any) => {
      sermonState = typeof updater === 'function' ? updater(sermonState) : updater;
    });
    (useSermonStructureData as jest.Mock).mockImplementation(() => ({
      sermon: sermonState,
      setSermon,
      containers: { introduction: [], main: [], conclusion: [], ambiguous: [] },
      setContainers: jest.fn(),
      outlinePoints: sermonState.outline,
      requiredTagColors: { introduction: '#000', main: '#000', conclusion: '#000' },
      allowedTags: [],
      loading: false,
      error: null,
      isAmbiguousVisible: true,
      setIsAmbiguousVisible: jest.fn(),
      syncFromEngine: jest.fn(),
      retry: jest.fn(),
    }));

    const { rerender } = render(<StructurePage />);
    await waitFor(() => expect(addOutlinePointHandler).not.toBeNull());

    let firstSave: Promise<void>;
    act(() => {
      firstSave = addOutlinePointHandler!('introduction', 1, 'Point A');
    });
    await waitFor(() => expect(updateSermonOutline).toHaveBeenCalledTimes(1));

    rerender(<StructurePage />);
    await act(async () => {
      await addOutlinePointHandler!('introduction', 2, 'Point B');
    });
    expect(serverOutline.introduction.map((point) => point.text)).not.toContain('Point B');

    await act(async () => {
      finishFirstSave!();
      await firstSave!;
    });
    expect(serverOutline.introduction.map((point) => point.text)).toContain('Point A');

    rerender(<StructurePage />);
    await act(async () => {
      await addOutlinePointHandler!('introduction', 3, 'Point C');
    });

    dateNowSpy.mockRestore();
    expect(serverOutline.introduction.map((point) => point.text)).toEqual(
      expect.arrayContaining(['Opening point', 'Point A', 'Point B', 'Point C'])
    );
  });
});
