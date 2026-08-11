import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';

import StructurePage from '@/(pages)/(private)/sermons/[id]/structure/page';
import { useSermonStructureData } from '@/hooks/useSermonStructureData';
import { updateStructure } from '@/services/structure.service';
import { deleteThought, updateThought } from '@/services/thought.service';
import { updateSermonOutline } from '@/services/outline.service';
import { getExportContent } from '@/utils/exportContent';
import { changedFields } from '@/utils/changedFields';
import { mergeOutline } from '@/utils/mergeOutline';
import { toast } from 'sonner';
import { createMockSermon, createMockThought, createMockItem, createMockSermonPoint } from '@test-utils/structure-test-utils';

jest.mock('@/hooks/useSermonStructureData');
jest.mock('@/services/structure.service', () => ({ updateStructure: jest.fn().mockResolvedValue({}) }));
jest.mock('@/services/thought.service', () => ({
  updateThought: jest.fn().mockResolvedValue({}),
  deleteThought: jest.fn().mockResolvedValue({}),
}));
jest.mock('@/services/outline.service', () => ({
  updateSermonOutline: jest.fn().mockResolvedValue({}),
}));
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
      const { deleteThought } = require('@/services/thought.service');
      const { updateStructure } = require('@/services/structure.service');
      await deleteThought('sermon-1', { id });
      await updateStructure('sermon-1', {});
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
      if (autoTriggerPointLock) {
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
    React.useEffect(() => {
      props.onDelete?.('amb-1', 'ambiguous');
    }, [props]);
    return <div data-testid="ambiguous-section" />;
  },
}));

describe('StructurePage handlers', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    window.confirm = jest.fn(() => true);
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
    });

    render(<StructurePage />);

    await waitFor(() => {
      expect(pushSpy).toHaveBeenCalled();
      expect(deleteThought).toHaveBeenCalled();
      expect(updateThought).toHaveBeenCalled();
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
    });

    render(<StructurePage />);

    await waitFor(() => {
      // The baseline is part of the contract, not decoration: it is what narrows the
      // write down to `isLocked` instead of the whole thought.
      expect(updateThought).toHaveBeenCalledWith(
        'sermon-1',
        expect.objectContaining({ id: 't1', isLocked: true }),
        expect.objectContaining({ id: 't1', isLocked: false }),
      );
    });

    expect(toast.success).toHaveBeenCalledWith('Thought locked');
  });

  /**
   * LOCKING A THOUGHT MUST NOT REVERT ITS TEXT.
   *
   * The lock toggle sends `{ ...thought, isLocked }`, where `thought` is this
   * screen's copy. The writer claims every field it is handed as changed unless it
   * is told what the screen STARTED from, so a tab that has been open since morning
   * republishes its stale text on top of an afternoon rewrite — and the person only
   * pressed a padlock.
   *
   * The assertion is about what SURVIVED in the stored thought, not about the
   * arguments of the call: a call-shape assertion stays green while the field diff
   * is broken, which is exactly what the neighbouring test above cannot catch.
   */
  it('keeps a text rewritten on another device when a thought is locked here', async () => {
    autoTriggerPointLock = false;
    autoTriggerThoughtLock = true;

    /** Stands in for the stored document — rewritten on the phone since this load. */
    let storedThought = createMockThought({
      id: 't1',
      text: 'Rewritten on the phone',
      tags: ['Introduction'],
      outlinePointId: 'op-1',
      isLocked: false,
    });

    (updateThought as jest.Mock).mockImplementation(
      async (_sermonId: string, updated: typeof storedThought, base?: typeof storedThought | null) => {
        // Exactly what the writer does (sermons.client.ts): with no base every field
        // handed over is claimed as changed.
        const intent = base ? changedFields(base, updated) : updated;
        storedThought = { ...storedThought, ...intent };
        return storedThought;
      }
    );

    const sermon = createMockSermon({
      id: 'sermon-1',
      thoughts: [
        createMockThought({
          id: 't1',
          // What this screen still shows: the wording from before the phone edit.
          text: 'This morning text',
          tags: ['Introduction'],
          outlinePointId: 'op-1',
          isLocked: false,
        }),
      ],
      structure: { introduction: ['t1'], main: [], conclusion: [], ambiguous: [] },
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
        introduction: [createMockItem({ id: 't1', content: 'This morning text', outlinePointId: 'op-1', isLocked: false })],
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
    });

    render(<StructurePage />);

    // The lock landed...
    await waitFor(() => expect(storedThought.isLocked).toBe(true));
    // ...and the words written on the other device are still there.
    expect(storedThought.text).toBe('Rewritten on the phone');
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

  it('rolls back optimistic point locking when one persistence request fails', async () => {
    let sermonState = createMockSermon({
      id: 'sermon-1',
      thoughts: [
        createMockThought({ id: 't1', text: 'Intro 1', tags: ['Introduction'], outlinePointId: 'op-1', isLocked: false }),
        createMockThought({ id: 't2', text: 'Intro 2', tags: ['Introduction'], outlinePointId: 'op-1', isLocked: false }),
      ],
      structure: {
        introduction: ['t1', 't2'],
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
      introduction: [
        createMockItem({ id: 't1', content: 'Intro 1', outlinePointId: 'op-1', isLocked: false }),
        createMockItem({ id: 't2', content: 'Intro 2', outlinePointId: 'op-1', isLocked: false }),
      ],
      main: [],
      conclusion: [],
      ambiguous: [],
    };
    const originalSermon = sermonState;
    const originalContainers = containersState;

    const setSermon = jest.fn((updater: any) => {
      sermonState = typeof updater === 'function' ? updater(sermonState) : updater;
    });
    const setContainers = jest.fn((updater: any) => {
      containersState = typeof updater === 'function' ? updater(containersState) : updater;
    });

    (updateThought as jest.Mock)
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce(new Error('lock failed'))
      .mockResolvedValueOnce({});

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
    });

    render(<StructurePage />);

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('Failed to save thought.');
    });

    // Each write states its baseline, so lock and rollback both carry `isLocked`
    // alone and never the rest of this screen's copy of the thought.
    expect(updateThought).toHaveBeenCalledWith(
      'sermon-1',
      expect.objectContaining({ id: 't1', isLocked: true }),
      expect.objectContaining({ id: 't1', isLocked: false }),
    );
    expect(updateThought).toHaveBeenCalledWith(
      'sermon-1',
      expect.objectContaining({ id: 't2', isLocked: true }),
      expect.objectContaining({ id: 't2', isLocked: false }),
    );
    expect(updateThought).toHaveBeenCalledWith(
      'sermon-1',
      expect.objectContaining({ id: 't1', isLocked: false }),
      expect.objectContaining({ id: 't1', isLocked: true }),
    );
    expect(setSermon).toHaveBeenCalledWith(originalSermon);
    expect(setContainers).toHaveBeenCalledWith(originalContainers);
  });

  it('stores an unlocked rollback for a legacy thought without an isLocked field', async () => {
    const firstThought = createMockThought({
      id: 't1',
      text: 'Legacy thought 1',
      tags: ['Introduction'],
      outlinePointId: 'op-1',
    });
    const secondThought = createMockThought({
      id: 't2',
      text: 'Legacy thought 2',
      tags: ['Introduction'],
      outlinePointId: 'op-1',
    });
    let storedThoughts = {
      t1: { ...firstThought },
      t2: { ...secondThought },
    };

    (updateThought as jest.Mock).mockImplementation(
      async (_sermonId: string, next: typeof firstThought, base?: typeof firstThought | null) => {
        if (next.id === 't2' && next.isLocked === true) {
          throw new Error('lock failed');
        }
        const intent = changedFields(base, next);
        storedThoughts = {
          ...storedThoughts,
          [next.id]: { ...storedThoughts[next.id as keyof typeof storedThoughts], ...intent },
        };
        return storedThoughts[next.id as keyof typeof storedThoughts];
      }
    );

    const sermon = createMockSermon({
      id: 'sermon-1',
      thoughts: [firstThought, secondThought],
      structure: { introduction: ['t1', 't2'], main: [], conclusion: [], ambiguous: [] },
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
        introduction: [
          createMockItem({ id: 't1', content: firstThought.text, outlinePointId: 'op-1' }),
          createMockItem({ id: 't2', content: secondThought.text, outlinePointId: 'op-1' }),
        ],
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
    });

    render(<StructurePage />);

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Failed to save thought.'));
    expect(storedThoughts.t1.isLocked).toBe(false);
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
