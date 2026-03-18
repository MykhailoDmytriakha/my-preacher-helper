import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';

import StructurePage from '@/(pages)/(private)/sermons/[id]/structure/page';
import { useSermonStructureData } from '@/hooks/useSermonStructureData';
import { updateStructure } from '@/services/structure.service';
import { deleteThought, updateThought } from '@/services/thought.service';
import { updateSermonOutline } from '@/services/outline.service';
import { getExportContent } from '@/utils/exportContent';
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
  useFocusMode: () => ({
    focusedColumn: focusModeState.focusedColumn,
    handleToggleFocusMode: jest.fn(),
    navigateToSection: jest.fn(),
  }),
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
      void props.onAddOutlinePoint?.(props.id, 0, 'Inserted point');
      if (autoTriggerPointLock) {
        void props.onTogglePointLock?.('op-1', true);
      }
      if (autoTriggerThoughtLock) {
        void props.onToggleThoughtLock?.('t1', true);
      }
      if (autoTriggerAiSort) {
        props.onAiSort?.();
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

  it('shows a confirmation modal before AI sorting locked thoughts', async () => {
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

    expect(handleAiSortSpy).not.toHaveBeenCalledWith('introduction');
    expect(await screen.findByText('Locked thoughts will also be re-sorted')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Continue anyway' }));

    await waitFor(() => {
      expect(handleAiSortSpy).toHaveBeenCalledWith('introduction');
    });
  });

  it('runs AI sorting immediately when the column has no locked thoughts', async () => {
    autoTriggerAiSort = true;
    autoTriggerPointLock = false;

    const sermon = createMockSermon({
      id: 'sermon-1',
      thoughts: [
        createMockThought({ id: 't1', text: 'Unlocked intro', tags: ['Introduction'], outlinePointId: 'op-1', isLocked: false }),
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
        introduction: [createMockItem({ id: 't1', content: 'Unlocked intro', outlinePointId: 'op-1', isLocked: false })],
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
      expect(handleAiSortSpy).toHaveBeenCalledWith('introduction');
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
      expect(updateThought).toHaveBeenCalledWith(
        'sermon-1',
        expect.objectContaining({ id: 't1', isLocked: true }),
      );
    });

    expect(toast.success).toHaveBeenCalledWith('Thought locked');
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

    expect(updateThought).toHaveBeenCalledWith(
      'sermon-1',
      expect.objectContaining({ id: 't1', isLocked: true }),
    );
    expect(updateThought).toHaveBeenCalledWith(
      'sermon-1',
      expect.objectContaining({ id: 't2', isLocked: true }),
    );
    expect(updateThought).toHaveBeenCalledWith(
      'sermon-1',
      expect.objectContaining({ id: 't1', isLocked: false }),
    );
    expect(setSermon).toHaveBeenCalledWith(originalSermon);
    expect(setContainers).toHaveBeenCalledWith(originalContainers);
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
});
