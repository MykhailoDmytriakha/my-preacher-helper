import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';

import StructurePage from '@/(pages)/(private)/sermons/[id]/structure/page';
import { useSermonStructureData } from '@/hooks/useSermonStructureData';
import { updateStructure } from '@/services/structure.service';
import { deleteThought } from '@/services/thought.service';
import { updateSermonOutline } from '@/services/outline.service';
import { getExportContent } from '@/utils/exportContent';
import { createMockSermon, createMockThought, createMockItem, createMockSermonPoint } from '@test-utils/structure-test-utils';

jest.mock('@/hooks/useSermonStructureData');
jest.mock('@/services/structure.service', () => ({ updateStructure: jest.fn().mockResolvedValue({}) }));
jest.mock('@/services/thought.service', () => ({
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
      handleAiSort: jest.fn(),
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
      props.onToggleReviewed?.('op-1', true);
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
      expect(updateSermonOutline).toHaveBeenCalled();
      expect(updateStructure).toHaveBeenCalled();
      expect(getExportContent).toHaveBeenCalled();
      expect(debouncedSaveThoughtSpy).toHaveBeenCalled();
    });
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
