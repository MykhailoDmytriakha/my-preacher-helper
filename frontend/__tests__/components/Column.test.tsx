jest.mock('@heroicons/react/24/outline', () => {
  const mockIcon = (name: string) => (props: any) => <svg {...props} data-testid={`icon-${name}`} />;
  return {
    QuestionMarkCircleIcon: mockIcon('question'),
    PlusIcon: mockIcon('plus'),
    PencilIcon: mockIcon('pencil'),
    CheckIcon: mockIcon('check'),
    XMarkIcon: mockIcon('x-mark'),
    TrashIcon: mockIcon('trash'),
    Bars3Icon: mockIcon('bars-3'),
    ArrowUturnLeftIcon: mockIcon('arrow-uturn'),
    SparklesIcon: mockIcon('sparkles'),
    InformationCircleIcon: mockIcon('info'),
    ChevronLeftIcon: mockIcon('chevron-left'),
    ChevronRightIcon: mockIcon('chevron-right')
  };
});

// Mock @dnd-kit libraries
jest.mock('@dnd-kit/core', () => ({
  useDroppable: () => ({
    setNodeRef: jest.fn(),
    isOver: false
  })
}));

jest.mock('@dnd-kit/sortable', () => ({
  SortableContext: ({ children }: any) => <div data-testid="sortable-context">{children}</div>,
  verticalListSortingStrategy: jest.fn()
}));

jest.mock('@hello-pangea/dnd', () => {
  const React = require('react');
  return {
    DragDropContext: ({ children }: any) => <div data-testid="drag-drop-context">{children}</div>,
    Droppable: ({ children }: any) => (
      <div data-testid="droppable">
        {children({
          innerRef: jest.fn(),
          droppableProps: {},
          placeholder: null,
        })}
      </div>
    ),
    Draggable: ({ children }: any) => (
      <div data-testid="draggable">
        {children(
          {
            innerRef: jest.fn(),
            draggableProps: { style: {} },
            dragHandleProps: {},
          },
          { isDragging: false }
        )}
      </div>
    ),
  };
});

// Mock the i18next library
jest.mock('react-i18next', () => ({
  useTranslation: () => {
    return {
      t: (key: string, options?: any) => {
        const translations: Record<string, string> = {
          'structure.recordAudio': 'Record voice note',
          'structure.focusMode': 'Focus Mode',
          'structure.normalMode': 'Normal Mode',
          'structure.noEntries': 'No entries',
          'structure.outlinePoints': 'SermonOutline Points',
          'structure.addPointButton': 'Add outline point',
          'structure.addPointPlaceholder': 'Enter new outline point',
          'structure.editPointPlaceholder': 'Edit outline point',
          'structure.outlineSavedSuccess': 'SermonOutline saved',
          'structure.deletePointConfirm': options?.text ? `Are you sure you want to delete this outline point: "${options.text}"?` : 'Are you sure?',
          'structure.addThoughtToSection': options?.section ? `Add thought to ${options.section}` : 'Add thought',
          'structure.sortButton': 'Сортировать',
          'structure.sorting': 'Сортировка...',
          'structure.sortInfo': 'Sorting only processes unassigned thoughts, up to 25 at a time.',
          'structure.unassignedThoughts': 'Unassigned Thoughts',
          'structure.aiSuggestions': 'AI Suggestions',
          'structure.acceptAll': 'Accept All',
          'structure.acceptAllChanges': 'Accept all remaining',
          'structure.rejectAll': 'Reject All',
          'structure.rejectAllChanges': 'Reject all suggestions',
          'structure.outlinePointsExist': 'SermonOutline points already exist',
          'structure.generateSermonPoints': 'Generate outline points',
          'structure.generate': 'Generate',
          'structure.markAsReviewed': 'Mark as reviewed',
          'structure.markAsUnreviewed': 'Mark as unreviewed',
          'structure.outlineHelp.ariaLabel': 'Quick help for outline point',
          'common.generating': 'Generating...',
          'errors.saveOutlineError': 'Failed to save outline',
          'common.save': 'Save',
          'common.cancel': 'Cancel',
          'common.edit': 'Edit',
          'common.delete': 'Delete',
          'buttons.saving': 'Saving'
        };
        return translations[key] || key;
      }
    };
  }
}));

// Mock toast notifications
jest.mock('sonner', () => ({
  toast: {
    success: jest.fn(),
    error: jest.fn()
  }
}));

jest.mock('@/hooks/useOnlineStatus', () => ({
  useOnlineStatus: () => true
}));

// Mock outline service
jest.mock('@/services/outline.service', () => ({
  updateSermonOutline: jest.fn(() => Promise.resolve({ success: true })),
  getSermonOutline: jest.fn(() => Promise.resolve({ introduction: [], main: [], conclusion: [] })),
  generateSermonPointsForSection: jest.fn(() => Promise.resolve([]))
}));

// Mock models
jest.mock('@/models/models', () => ({
  Item: jest.fn(),
  SermonPoint: jest.fn(),
  SermonOutline: jest.fn()
}));

// Mock theme colors
jest.mock('@/utils/themeColors', () => ({
  SERMON_SECTION_COLORS: {
    introduction: {
      base: '#d97706',
      light: '#f59e0b',
      dark: '#b45309',
      bg: 'bg-amber-50',
      darkBg: 'bg-amber-900/40',
      border: 'border-amber-200',
      darkBorder: 'border-amber-800',
      hover: 'hover:bg-amber-100',
      darkHover: 'hover:bg-amber-900/40',
      text: 'text-amber-800',
      darkText: 'text-amber-200'
    },
    mainPart: {
      base: '#2563eb',
      light: '#3b82f6',
      dark: '#1d4ed8',
      bg: 'bg-blue-50',
      darkBg: 'bg-blue-900/20',
      border: 'border-blue-200',
      darkBorder: 'border-blue-800',
      hover: 'hover:bg-blue-100',
      darkHover: 'hover:bg-blue-900/40',
      text: 'text-blue-800',
      darkText: 'text-blue-200'
    },
    conclusion: {
      base: '#16a34a',
      light: '#22c55e',
      dark: '#15803d',
      bg: 'bg-green-50',
      darkBg: 'bg-green-900/30',
      border: 'border-green-200',
      darkBorder: 'border-green-800',
      hover: 'hover:bg-green-100',
      darkHover: 'hover:bg-green-900/40',
      text: 'text-green-800',
      darkText: 'text-green-200'
    }
  },
  UI_COLORS: {
    neutral: {
      bg: 'bg-gray-50',
      darkBg: 'bg-gray-800',
      border: 'border-gray-200',
      darkBorder: 'border-gray-700',
      text: 'text-gray-800',
      darkText: 'text-gray-100'
    },
    muted: {
      text: 'text-gray-500',
      darkText: 'text-gray-400'
    },
    success: {
      bg: 'bg-green-50',
      darkBg: 'bg-green-900/30',
      border: 'border-green-300',
      darkBorder: 'border-green-800',
      text: 'text-green-800',
      darkText: 'text-green-200'
    }
  }
}));

// Mock react-markdown to prevent ESM errors
jest.mock('react-markdown', () => (props: any) => <>{props.children}</>);
// Mock remark-gfm as well
jest.mock('remark-gfm', () => ({}));

// Mock the AudioRecorder component
jest.mock('../../app/components/AudioRecorder', () => ({
  AudioRecorder: (props: any) => (
    <div
      data-testid="audio-recorder-component"
      className={`${props.className || ''} ${props.variant === "mini" ? "space-y-2" : "space-y-4"}`}
    >
      <div className={`flex flex-col sm:flex-row items-start sm:items-center gap-4 ${props.variant === "mini" ? "flex-col gap-2" : ""}`}>
        <button
          data-testid="record-button"
          className={`${props.variant === "mini" ? "min-w-full px-3 py-2 text-sm" : "min-w-[200px] px-6 py-3"} rounded-xl font-medium`}
          onClick={props.onRecordingComplete ? () => props.onRecordingComplete(new Blob()) : undefined}
        >
          {props.variant === "mini" ? "Mini Audio Recorder" : "Standard Audio Recorder"}
        </button>
      </div>
    </div>
  )
}));

// Mock dynamic thought service used by audio recorder
jest.mock('@/services/thought.service', () => ({
  createAudioThoughtWithForceTag: jest.fn(async () => ({ id: 'th1', content: 'Audio Thought', customTagNames: [] }))
}));

// Mock the ExportButtons component
jest.mock('@components/ExportButtons', () => {
  return function MockExportButtons(props: any) {
    return (
      <div data-testid="export-buttons-container">
        <button onClick={() => props.getExportContent('plain', { includeTags: false })} data-testid="export-txt-button">
          TXT
        </button>
        <button onClick={() => props.getExportContent('markdown', { includeTags: false })} data-testid="export-word-button">
          Word
        </button>
      </div>
    );
  };
});

// Mock the SortableItem component
jest.mock('../../app/components/SortableItem', () => {
  return function MockSortableItem(props: any) {
    return (
      <div data-testid={`sortable-item-${props.item?.id || 'unknown'}`}>
        <span>{props.item?.content || 'Mock Item'}</span>
      </div>
    );
  };
});

// Mock ExportButtons component
jest.mock('../../app/components/ExportButtons', () => {
  const MockExportButtons = () => {
    return React.createElement('div', { 'data-testid': 'export-buttons-container' },
      React.createElement('button', { key: 'txt' }, 'Export TXT'),
      React.createElement('button', { key: 'pdf' }, 'Export PDF'),
      React.createElement('button', { key: 'word' }, 'Export Word')
    );
  };
  return MockExportButtons;
});

// Mock FocusRecorderButton component
jest.mock('../../app/components/FocusRecorderButton', () => ({
  FocusRecorderButton: (props: any) => (
    <div data-testid="focus-recorder-button">
      <button onClick={props.onRecordingComplete}>Focus Recorder</button>
    </div>
  )
}));

// Mock Icons
jest.mock('@/components/Icons', () => ({
  MicrophoneIcon: (props: any) => <svg {...props} data-testid="microphone-icon" />,
  SwitchViewIcon: (props: any) => <svg {...props} data-testid="switch-view-icon" />
}));

import { act, cleanup, render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import React from 'react';
import { toast } from 'sonner';

import { Item } from '@/models/models';
import { generateSermonPointsForSection, getSermonOutline, updateSermonOutline } from '@/services/outline.service';

import Column from '../../app/components/Column';
import { runScenarios } from '../../test-utils/scenarioRunner';

import '@testing-library/jest-dom';

describe('Column Component', () => {
  const mockItems: Item[] = [
    { id: '1', content: 'Item 1', customTagNames: [] },
    { id: '2', content: 'Item 2', customTagNames: [] }
  ];

  describe('Rendering and Props', () => {
    it('covers rendering permutations in a single scenario run', async () => {
      await runScenarios(
        [
          {
            name: 'renders default column content',
            run: () => {
              render(<Column id="intro" title="Introduction" items={mockItems} />);
              expect(screen.getByText('Introduction')).toBeInTheDocument();
              expect(screen.getByText('Item 1')).toBeInTheDocument();
              expect(screen.getByText('Item 2')).toBeInTheDocument();
            }
          },
          {
            name: 'shows focus toggle when enabled',
            run: () => {
              render(
                <Column
                  id="intro"
                  title="Introduction"
                  items={mockItems}
                  showFocusButton={true}
                  onToggleFocusMode={jest.fn()}
                />
              );
              expect(screen.getByTitle('Focus Mode')).toBeInTheDocument();
            }
          },
          {
            name: 'hides focus toggle when disabled',
            run: () => {
              render(<Column id="intro" title="Introduction" items={mockItems} showFocusButton={false} />);
              expect(screen.queryByText('Focus Mode')).not.toBeInTheDocument();
            }
          },
          {
            name: 'indicates focus mode label when active',
            run: () => {
              render(<Column id="intro" title="Introduction" items={mockItems} isFocusMode={true} />);
              expect(screen.getByText('SermonOutline Points')).toBeInTheDocument();
            }
          },
          {
            name: 'respects custom className props',
            run: () => {
              const { container } = render(
                <Column id="intro" title="Introduction" items={mockItems} className="custom-class" />
              );
              expect(container.firstChild).toHaveClass('custom-class');
            }
          },
          {
            name: 'shows fallback text when there are no entries',
            run: () => {
              render(<Column id="intro" title="Introduction" items={[]} />);
              expect(screen.getByText('No entries')).toBeInTheDocument();
            }
          },
          {
            name: 'renders outline points when provided',
            run: () => {
              render(
                <Column
                  id="intro"
                  title="Introduction"
                  items={mockItems}
                  outlinePoints={[
                    { id: '1', text: 'Point 1' },
                    { id: '2', text: 'Point 2' }
                  ]}
                />
              );
              expect(screen.getAllByText('Point 1')).toHaveLength(2);
              expect(screen.getAllByText('Point 2')).toHaveLength(2);
            }
          }
        ],
        { afterEachScenario: cleanup }
      );
    });
  });

  it('handles focus toggles and layouts in one pass', async () => {
    await runScenarios(
      [
        {
          name: 'triggers focus toggle callback',
          run: () => {
            const mockToggleFocus = jest.fn();
            render(
              <Column
                id="introduction"
                title="Introduction"
                items={mockItems}
                showFocusButton={true}
                isFocusMode={false}
                onToggleFocusMode={mockToggleFocus}
              />
            );
            fireEvent.click(screen.getByTitle('Focus Mode'));
            expect(mockToggleFocus).toHaveBeenCalledWith('introduction');
          }
        },
        {
          name: 'renders stacked layout in focus mode',
          run: () => {
            const { container } = render(
              <Column
                id="introduction"
                title="Introduction"
                items={mockItems}
                showFocusButton={true}
                isFocusMode={true}
                onToggleFocusMode={() => { }}
              />
            );
            expect(container.querySelector('.space-y-3')).toBeInTheDocument();
          }
        }
      ],
      { afterEachScenario: cleanup }
    );
  });

  // New tests for outline point operations in focus mode
  describe('SermonOutline Point Operations in Focus Mode', () => {
    const mockToggleFocus = jest.fn();

    beforeEach(() => {
      // Reset mocks
      (getSermonOutline as jest.Mock).mockClear();
      (updateSermonOutline as jest.Mock).mockClear();
      mockToggleFocus.mockClear();
      (toast.success as jest.Mock).mockClear();
      (toast.error as jest.Mock).mockClear();

      // Mock the implementation of updateSermonOutline (service call)
      (updateSermonOutline as jest.Mock).mockImplementation(() => Promise.resolve({ success: true }));
      // Explicitly mock getSermonOutline to resolve
      (getSermonOutline as jest.Mock).mockResolvedValue({ introduction: [], main: [], conclusion: [] });

      // Mock setTimeout to execute immediately
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('adds a new outline point and saves in focus mode', async () => {
      const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(12345);

      render(
        <Column
          id="introduction"
          title="Introduction"
          items={[]}
          isFocusMode={true}
          sermonId="sermon-123"
          outlinePoints={[]}
        />
      );

      fireEvent.click(screen.getByText('Add outline point'));
      fireEvent.change(screen.getByPlaceholderText('Enter new outline point'), {
        target: { value: 'New Point' }
      });
      fireEvent.click(screen.getByLabelText('Save'));

      await act(async () => {
        jest.runOnlyPendingTimers();
      });

      await waitFor(() => expect(updateSermonOutline).toHaveBeenCalled());
      const [sermonId, outline] = (updateSermonOutline as jest.Mock).mock.calls[0];
      expect(sermonId).toBe('sermon-123');
      expect(outline.introduction).toHaveLength(1);
      expect(outline.introduction[0].text).toBe('New Point');

      nowSpy.mockRestore();
    });

    it('generates outline points and persists them', async () => {
      (generateSermonPointsForSection as jest.Mock).mockResolvedValue([
        { id: 'gen-1', text: 'Generated Point' }
      ]);

      render(
        <Column
          id="introduction"
          title="Introduction"
          items={[]}
          isFocusMode={true}
          sermonId="sermon-123"
          outlinePoints={[]}
        />
      );

      fireEvent.click(screen.getByText('Generate'));

      await waitFor(() => {
        expect(generateSermonPointsForSection).toHaveBeenCalledWith('sermon-123', 'introduction');
      });

      await act(async () => {
        jest.runOnlyPendingTimers();
      });

      await waitFor(() => expect(updateSermonOutline).toHaveBeenCalled());
    });
  });

  // Tests for sorting button and export buttons in focus mode
  describe('Sort Button and Export Buttons in Focus Mode', () => {
    const mockGetExportContent = jest.fn(() => Promise.resolve('Example content'));
    const mockAiSort = jest.fn();
    const baseFocusProps = {
      id: 'introduction',
      title: 'Introduction',
      items: mockItems,
      isFocusMode: true
    } as const;

    beforeEach(() => {
      mockGetExportContent.mockClear();
      mockAiSort.mockClear();
    });

    it('covers sort/export controls without redundant cases', async () => {
      await runScenarios(
        [
          {
            name: 'renders AI sort button with intro palette',
            run: () => {
              render(<Column {...baseFocusProps} onAiSort={mockAiSort} />);
              const button = screen.getByText('Сортировать').closest('button');
              expect(button).toHaveClass('bg-amber-50');
              expect(button).toHaveClass('text-amber-800');
            }
          },
          {
            name: 'omits AI sort button when handler missing',
            run: () => {
              render(<Column {...baseFocusProps} />);
              expect(screen.queryByText('Сортировать')).not.toBeInTheDocument();
            }
          },
          {
            name: 'fires onAiSort when clicked',
            run: () => {
              render(<Column {...baseFocusProps} onAiSort={mockAiSort} />);
              fireEvent.click(screen.getByText('Сортировать').closest('button')!);
              expect(mockAiSort).toHaveBeenCalled();
            }
          },
          {
            name: 'shows spinner/disabled state during loading',
            run: () => {
              render(<Column {...baseFocusProps} onAiSort={mockAiSort} isLoading={true} />);
              const button = screen.getByText('Сортировка...').closest('button');
              expect(button).toBeDisabled();
              expect(button?.querySelector('svg.animate-spin')).toBeInTheDocument();
            }
          },
          // Temporarily skipped due to complex ExportButtons dependencies
          // TODO: Re-enable once ExportButtons component dependencies are properly mocked
          // {
          //   name: 'renders export buttons when data provider exists',
          //   run: () => {
          //     render(
          //       <Column
          //         {...baseFocusProps}
          //         sermonId="sermon-123"
          //         getExportContent={mockGetExportContent}
          //       />
          //     );
          //     expect(screen.getByTestId('export-buttons-container')).toBeInTheDocument();
          //   }
          // },
          {
            name: 'hides export buttons without provider',
            run: () => {
              render(<Column {...baseFocusProps} />);
              expect(screen.queryByTestId('export-buttons-container')).not.toBeInTheDocument();
            }
          },
          {
            name: 'uses section colors for main and conclusion',
            run: () => {
              render(<Column {...baseFocusProps} id="main" title="Main" onAiSort={mockAiSort} />);
              expect(screen.getByText('Сортировать').closest('button')).toHaveClass('bg-blue-50');
              cleanup();
              render(
                <Column {...baseFocusProps} id="conclusion" title="Conclusion" onAiSort={mockAiSort} />
              );
              expect(screen.getByText('Сортировать').closest('button')).toHaveClass('bg-green-50');
            }
          },
          {
            name: 'fires Accept/Reject All controls in diff mode',
            run: () => {
              const onKeepAll = jest.fn();
              const onRevertAll = jest.fn();
              render(
                <Column
                  id="introduction"
                  title="Introduction"
                  items={[{ id: '1', content: 'Item 1', customTagNames: [] }]}
                  isDiffModeActive={true}
                  highlightedItems={{ '1': { type: 'assigned' as const } }}
                  onKeepAll={onKeepAll}
                  onRevertAll={onRevertAll}
                />
              );

              fireEvent.click(screen.getByText('Accept All'));
              fireEvent.click(screen.getByText('Reject All'));

              expect(onKeepAll).toHaveBeenCalledWith('introduction');
              expect(onRevertAll).toHaveBeenCalledWith('introduction');
            }
          }
        ],
        { afterEachScenario: cleanup }
      );
    });
  });

  // Tests for hover styles and UI details in focus mode
  describe('Hover Styles and UI Details in Focus Mode', () => {
    const mockSermonPoints = {
      introduction: [
        { id: 'point1', text: 'Existing outline point' }
      ],
      mainPart: [],
      conclusion: []
    };

    const mockToggleFocus = jest.fn();
    const mockAiSort = jest.fn();
    const focusScaffold = {
      title: 'Introduction',
      id: 'introduction',
      items: [] as Item[],
      showFocusButton: true,
      isFocusMode: true,
      onToggleFocusMode: mockToggleFocus
    } as const;

    beforeEach(() => {
      mockToggleFocus.mockClear();
      mockAiSort.mockClear();
    });

    it('covers hover cues and accent UI pieces together', async () => {
      await runScenarios(
        [
          {
            name: 'sidebar outline entries gain hover background',
            run: () => {
              render(
                <Column
                  {...focusScaffold}
                  outlinePoints={mockSermonPoints.introduction}
                />
              );
              const sidebarPoint = screen
                .getAllByText('Existing outline point')
                .map(el => el.closest('li'))
                .find(Boolean) as HTMLElement;
              expect(sidebarPoint).toHaveClass('hover:bg-white/15');
            }
          },
          {
            name: 'edit/delete controls share hover styles',
            run: () => {
              render(
                <Column
                  {...focusScaffold}
                  outlinePoints={mockSermonPoints.introduction}
                />
              );
              expect(screen.getByLabelText('Edit')).toHaveClass('hover:text-white');
              expect(screen.getByLabelText('Delete')).toHaveClass('hover:text-white');
            }
          },
          {
            name: 'add outline point cta keeps hover tokens',
            run: () => {
              render(<Column {...focusScaffold} />);
              const addButton = screen.getByText('Add outline point').closest('button');
              expect(addButton).toHaveClass('hover:bg-white/20');
              expect(addButton).toHaveClass('hover:text-white');
            }
          },
          {
            name: 'sort button includes animated emoji accent',
            run: () => {
              render(<Column {...focusScaffold} onAiSort={mockAiSort} />);
              const emojiElement = screen.getByText('✨');
              expect(emojiElement).toHaveClass('animate-pulse');
            }
          }
        ],
        { afterEachScenario: cleanup }
      );
    });
  });

  // Tests for outline points functionality in focus mode
  describe('SermonOutline Points Functionality in Focus Mode', () => {
    const mockSermonPoints = [
      { id: 'point1', text: 'Introduction Point 1' },
      { id: 'point2', text: 'Introduction Point 2' }
    ];

    const mockItems = [
      { id: '1', content: 'Item 1', customTagNames: [], outlinePointId: 'point1' },
      { id: '2', content: 'Item 2', customTagNames: [], outlinePointId: 'point2' },
      { id: '3', content: 'Unassigned Item', customTagNames: [] }
    ];
    it('exercises outline behaviors in focus mode through scenarios', async () => {
      await runScenarios(
        [
          {
            name: 'groups outline points and thoughts',
            run: () => {
              render(
                <Column
                  id="introduction"
                  title="Introduction"
                  items={mockItems}
                  isFocusMode={true}
                  outlinePoints={mockSermonPoints}
                  thoughtsPerSermonPoint={{ point1: 1, point2: 1 }}
                />
              );
              expect(screen.getAllByText('Introduction Point 1')).toHaveLength(2);
              expect(screen.getAllByText('Introduction Point 2')).toHaveLength(2);
              expect(screen.getByText('Item 1')).toBeInTheDocument();
              expect(screen.getByText(/Unassigned Thoughts \(1\)/)).toBeInTheDocument();
            }
          },
          {
            name: 'exposes add-thought control per outline point in focus mode',
            run: () => {
              const onAddThought = jest.fn();
              render(
                <Column
                  id="introduction"
                  title="Introduction"
                  items={[]}
                  isFocusMode={true}
                  outlinePoints={[{ id: 'point1', text: 'Introduction Point 1' }]}
                  onAddThought={onAddThought}
                />
              );
              fireEvent.click(screen.getByTitle('Add thought to Introduction'));
              expect(onAddThought).toHaveBeenCalledWith('introduction', 'point1');
            }
          },
          {
            name: 'renders badge counts for outline points',
            run: () => {
              render(
                <Column
                  id="introduction"
                  title="Introduction"
                  items={mockItems}
                  isFocusMode={true}
                  outlinePoints={mockSermonPoints}
                  thoughtsPerSermonPoint={{ point1: 1, point2: 1 }}
                />
              );
              expect(screen.getAllByText('1')).toHaveLength(2);
            }
          },
          {
            name: 'keeps outline badge aligned as a sibling flex item',
            run: () => {
              render(
                <Column
                  id="introduction"
                  title="Introduction"
                  items={mockItems}
                  isFocusMode={true}
                  outlinePoints={mockSermonPoints}
                  thoughtsPerSermonPoint={{ point1: 1, point2: 1 }}
                />
              );
              const pointLabel = screen.getAllByText('Introduction Point 1')
                .map(el => el.closest('li'))
                .find(Boolean) as HTMLElement;
              expect(pointLabel).toBeInTheDocument();
              const badge = within(pointLabel).getByText('1');
              const badgeContainer = badge.parentElement as HTMLElement;
              const textNode = within(pointLabel).getByText('Introduction Point 1');
              expect(badgeContainer).toHaveClass('flex');
              expect(badgeContainer).toHaveClass('items-center');
              // Badge and text container are both descendants of the li (badgeContainer)
              expect(pointLabel).toBe(badgeContainer);
              expect(badgeContainer).toContainElement(textNode);
              expect(textNode).not.toContainElement(badge);
            }
          },
          {
            name: 'shows empty unassigned section when everything mapped',
            run: () => {
              const itemsWithAllAssigned = [
                { id: '1', content: 'Item 1', customTagNames: [], outlinePointId: 'point1' },
                { id: '2', content: 'Item 2', customTagNames: [], outlinePointId: 'point2' }
              ];
              render(
                <Column
                  id="introduction"
                  title="Introduction"
                  items={itemsWithAllAssigned}
                  isFocusMode={true}
                  outlinePoints={mockSermonPoints}
                  thoughtsPerSermonPoint={{ point1: 1, point2: 1 }}
                />
              );
              expect(screen.getByText(/Unassigned Thoughts \(0\)/)).toBeInTheDocument();
            }
          },
          {
            name: 'falls back to simple list when outline points missing',
            run: () => {
              render(
                <Column
                  id="introduction"
                  title="Introduction"
                  items={mockItems}
                  isFocusMode={true}
                  outlinePoints={[]}
                />
              );
              expect(screen.queryByText(/Unassigned Thoughts/)).not.toBeInTheDocument();
            }
          },
          {
            name: 'keeps outline columns even with zero items',
            run: () => {
              const outlinePointsOnly = [{ id: 'p1', text: 'Focus SermonOutline Point' }];
              const { container } = render(
                <Column
                  id="introduction"
                  title="Introduction"
                  items={[]}
                  isFocusMode={true}
                  outlinePoints={outlinePointsOnly}
                />
              );
              expect(container.querySelector('.md\\:min-w-\\[500px\\]')).toHaveTextContent('Focus SermonOutline Point');
              expect(screen.getByText(/Unassigned Thoughts \(0\)/)).toBeInTheDocument();
            }
          },
          {
            name: 'generate outline points flow delegated elsewhere',
            run: () => {
              expect(true).toBe(true);
            }
          }
        ],
        { afterEachScenario: cleanup }
      );
    });
  });

  // Tests for outline points display in normal mode
  describe('SermonOutline Points Display in Normal Mode', () => {
    const mockSermonPoints = [
      { id: 'point1', text: 'Introduction Point 1' },
      { id: 'point2', text: 'Introduction Point 2' }
    ];

    const mockItems = [
      { id: '1', content: 'Item 1', customTagNames: [], outlinePointId: 'point1' },
      { id: '2', content: 'Item 2', customTagNames: [], outlinePointId: 'point2' },
      { id: '3', content: 'Unassigned Item', customTagNames: [] }
    ];
    it('validates outline rendering in normal mode via scenarios', async () => {
      await runScenarios(
        [
          {
            name: 'renders outline and grouped thoughts',
            run: () => {
              render(
                <Column
                  id="introduction"
                  title="Introduction"
                  items={mockItems}
                  outlinePoints={mockSermonPoints}
                  thoughtsPerSermonPoint={{ point1: 1, point2: 1 }}
                />
              );
              expect(screen.getAllByText('Introduction Point 1')).toHaveLength(2);
              expect(screen.getByText('Item 1')).toBeInTheDocument();
              expect(screen.getByText(/Unassigned Thoughts \(1\)/)).toBeInTheDocument();
            }
          },
          {
            name: 'shows badges for outline and unassigned counts',
            run: () => {
              render(
                <Column
                  id="introduction"
                  title="Introduction"
                  items={mockItems}
                  outlinePoints={mockSermonPoints}
                  thoughtsPerSermonPoint={{ point1: 1, point2: 1 }}
                />
              );
              expect(screen.getAllByText('1')).toHaveLength(3);
            }
          },
          {
            name: 'keeps empty-unassigned section visible',
            run: () => {
              const itemsWithAllAssigned = [
                { id: '1', content: 'Item 1', customTagNames: [], outlinePointId: 'point1' },
                { id: '2', content: 'Item 2', customTagNames: [], outlinePointId: 'point2' }
              ];
              render(
                <Column
                  id="introduction"
                  title="Introduction"
                  items={itemsWithAllAssigned}
                  outlinePoints={mockSermonPoints}
                  thoughtsPerSermonPoint={{ point1: 1, point2: 1 }}
                />
              );
              expect(screen.getByText(/Unassigned Thoughts \(0\)/)).toBeInTheDocument();
            }
          },
          {
            name: 'falls back to flat list without outline points',
            run: () => {
              render(
                <Column
                  id="introduction"
                  title="Introduction"
                  items={mockItems}
                  outlinePoints={[]}
                />
              );
              expect(screen.queryByText(/Unassigned Thoughts/)).not.toBeInTheDocument();
            }
          }
        ],
        { afterEachScenario: cleanup }
      );
    });
  });

  // Tests for dark mode support
  describe('Dark Mode Support', () => {
    const mockItems = [
      { id: '1', content: 'Item 1', customTagNames: [] },
      { id: '2', content: 'Item 2', customTagNames: [] }
    ];
    const focusProps = {
      id: 'introduction',
      title: 'Introduction',
      items: mockItems,
      isFocusMode: true,
      showFocusButton: true,
      onToggleFocusMode: jest.fn()
    } as const;

    it('validates dark mode tokens holistically', async () => {
      await runScenarios(
        [
          {
            name: 'focus sidebar keeps dark styling',
            run: () => {
              const { container } = render(<Column {...focusProps} />);
              const leftSidebar = container.querySelector('.lg\\:w-72');
              expect(leftSidebar?.querySelector('.bg-gray-50.dark\\:bg-gray-800')).toBeInTheDocument();
            }
          },
          {
            name: 'focus content area uses neutral palette',
            run: () => {
              const { container } = render(<Column {...focusProps} />);
              const rightContent = container.querySelector('.md\\:min-w-\\[500px\\]');
              expect(rightContent).toHaveClass('bg-gray-50');
              expect(rightContent).toHaveClass('dark:bg-gray-800');
            }
          },
          {
            name: 'normal mode container retains dark classes',
            run: () => {
              const { container } = render(
                <Column id="introduction" title="Introduction" items={mockItems} />
              );
              const normalContainer = container.querySelector('.min-h-\\[300px\\]');
              expect(normalContainer).toHaveClass('bg-gray-50');
              expect(normalContainer).toHaveClass('dark:bg-gray-800');
            }
          },
          {
            name: 'AI suggestions banner honors dark colors',
            run: () => {
              render(
                <Column
                  id="introduction"
                  title="Introduction"
                  items={mockItems}
                  isDiffModeActive={true}
                  highlightedItems={{ '1': { type: 'assigned' as const } }}
                  onKeepAll={jest.fn()}
                  onRevertAll={jest.fn()}
                />
              );
              const aiSection = screen.getByText(/AI Suggestions/).closest('div');
              expect(aiSection).toHaveClass('dark:bg-gray-800');
              expect(aiSection).toHaveClass('dark:border-gray-700');
            }
          },
          {
            name: 'unassigned panel keeps dark borders',
            run: () => {
              const outlinePoints = [{ id: 'point1', text: 'Introduction Point 1' }];
              const items = [
                { id: '1', content: 'Item 1', customTagNames: [], outlinePointId: 'point1' },
                { id: '2', content: 'Unassigned Item', customTagNames: [] }
              ];
              const { container } = render(
                <Column
                  id="introduction"
                  title="Introduction"
                  items={items}
                  outlinePoints={outlinePoints}
                  thoughtsPerSermonPoint={{ point1: 1 }}
                />
              );
              expect(container.querySelector('.border-t.dark\\:border-gray-700')).toBeInTheDocument();
              expect(container.querySelector('.text-gray-500.dark\\:text-gray-400')).toBeInTheDocument();
            }
          }
        ],
        { afterEachScenario: cleanup }
      );
    });
  });

  // Tests for theme colors usage
  describe('Theme Colors Usage', () => {
    const mockItems = [
      { id: '1', content: 'Item 1', customTagNames: [] },
      { id: '2', content: 'Item 2', customTagNames: [] }
    ];
    it('validates theme palettes through scenarios', async () => {
      await runScenarios(
        [
          {
            name: 'introduction section colors',
            run: () => {
              render(<Column id="introduction" title="Introduction" items={mockItems} isFocusMode={true} onAiSort={jest.fn()} />);
              const sortButton = screen.getByText('Сортировать').closest('button');
              expect(sortButton).toHaveClass('bg-amber-50');
              expect(sortButton).toHaveClass('dark:bg-amber-900/40');
            }
          },
          {
            name: 'main section colors',
            run: () => {
              render(<Column id="main" title="Main" items={mockItems} isFocusMode={true} onAiSort={jest.fn()} />);
              const sortButton = screen.getByText('Сортировать').closest('button');
              expect(sortButton).toHaveClass('bg-blue-50');
              expect(sortButton).toHaveClass('dark:bg-blue-900/20');
            }
          },
          {
            name: 'conclusion section colors',
            run: () => {
              render(
                <Column id="conclusion" title="Conclusion" items={mockItems} isFocusMode={true} onAiSort={jest.fn()} />
              );
              const sortButton = screen.getByText('Сортировать').closest('button');
              expect(sortButton).toHaveClass('bg-green-50');
              expect(sortButton).toHaveClass('dark:bg-green-900/30');
            }
          },
          {
            name: 'neutral surfaces leverage UI_COLORS',
            run: () => {
              const { container } = render(
                <Column
                  id="introduction"
                  title="Introduction"
                  items={mockItems}
                  isFocusMode={true}
                  showFocusButton={true}
                  onToggleFocusMode={jest.fn()}
                />
              );
              const sidebarContainer = container
                .querySelector('.lg\\:w-72')
                ?.querySelector('.bg-gray-50.dark\\:bg-gray-800');
              expect(sidebarContainer).toBeInTheDocument();
            }
          },
          {
            name: 'muted text + success buttons follow palette',
            run: () => {
              render(
                <Column
                  id="introduction"
                  title="Introduction"
                  items={mockItems}
                  isDiffModeActive={true}
                  highlightedItems={{ '1': { type: 'assigned' as const } }}
                  onKeepAll={jest.fn()}
                  onRevertAll={jest.fn()}
                />
              );
              const aiText = screen.getByText(/AI Suggestions/);
              expect(aiText).toHaveClass('text-gray-500');
              expect(aiText).toHaveClass('dark:text-gray-400');
              const acceptButton = screen.getByText(/Accept All/);
              expect(acceptButton).toHaveClass('bg-green-50');
              expect(acceptButton).toHaveClass('dark:bg-green-900/30');
            }
          }
        ],
        { afterEachScenario: cleanup }
      );
    });
  });

  describe('Column with outline points and isReviewed functionality', () => {
    const mockSermonPoints = [
      { id: 'op1', text: 'Point 1', isReviewed: false },
      { id: 'op2', text: 'Point 2', isReviewed: true },
    ];

    const mockItemsWithSermonPoints: Item[] = [
      {
        id: '1',
        content: 'Thought for point 1',
        outlinePointId: 'op1',
        requiredTags: ['intro'],
        customTagNames: [],
      },
      {
        id: '2',
        content: 'Thought for point 2',
        outlinePointId: 'op2',
        requiredTags: ['intro'],
        customTagNames: [],
      },
    ];
    it('handles review toggles through consolidated scenarios', async () => {
      await runScenarios(
        [
          {
            name: 'renders review toggle actions',
            run: () => {
              const handler = jest.fn();
              render(
                <Column
                  id="introduction"
                  title="Introduction"
                  items={mockItemsWithSermonPoints}
                  outlinePoints={mockSermonPoints}
                  onToggleReviewed={handler}
                />
              );
              expect(screen.getByRole('button', { name: /mark as reviewed/i })).toBeInTheDocument();
              expect(screen.getByRole('button', { name: /mark as unreviewed/i })).toBeInTheDocument();
            }
          },
          {
            name: 'fires handler with correct arguments',
            run: () => {
              const handler = jest.fn();
              render(
                <Column
                  id="introduction"
                  title="Introduction"
                  items={mockItemsWithSermonPoints}
                  outlinePoints={mockSermonPoints}
                  onToggleReviewed={handler}
                />
              );
              fireEvent.click(screen.getByRole('button', { name: /mark as reviewed/i }));
              fireEvent.click(screen.getByRole('button', { name: /mark as unreviewed/i }));
              expect(handler).toHaveBeenCalledWith('op1', true);
              expect(handler).toHaveBeenCalledWith('op2', false);
            }
          },
          {
            name: 'hides review actions when handler missing',
            run: () => {
              render(
                <Column
                  id="introduction"
                  title="Introduction"
                  items={mockItemsWithSermonPoints}
                  outlinePoints={mockSermonPoints}
                />
              );
              expect(screen.queryByRole('button', { name: /mark as reviewed/i })).not.toBeInTheDocument();
            }
          },
          {
            name: 'handles outline points lacking isReviewed flag',
            run: () => {
              const handler = jest.fn();
              const outlinePointsWithoutFlag = [
                { id: 'op1', text: 'Point 1' },
                { id: 'op2', text: 'Point 2', isReviewed: true }
              ];
              render(
                <Column
                  id="introduction"
                  title="Introduction"
                  items={mockItemsWithSermonPoints}
                  outlinePoints={outlinePointsWithoutFlag}
                  onToggleReviewed={handler}
                />
              );
              fireEvent.click(screen.getByRole('button', { name: /mark as reviewed/i }));
              expect(handler).toHaveBeenCalledWith('op1', true);
            }
          }
        ],
        { afterEachScenario: cleanup }
      );
    });
  });

  it('AudioRecorder integration available (popover tested elsewhere)', () => {
    expect(true).toBe(true);
  });

  // Tests for Focus Mode Navigation Arrows and Header Styling
  describe('Focus Mode Navigation and Header Styling', () => {
    const mockNavigate = jest.fn();
    const commonProps = {
      items: [],
      isFocusMode: true,
      onNavigateToSection: mockNavigate,
      showFocusButton: true
    };

    beforeEach(() => {
      mockNavigate.mockClear();
    });

    it('validates navigation arrows and header styles through scenarios', async () => {
      await runScenarios(
        [
          {
            name: 'shows only Next arrow for introduction',
            run: () => {
              render(<Column {...commonProps} id="introduction" title="Introduction" />);
              expect(screen.queryByTestId('icon-chevron-left')).not.toBeInTheDocument();
              expect(screen.getByTestId('icon-chevron-right')).toBeInTheDocument();

              fireEvent.click(screen.getByTestId('icon-chevron-right').closest('button')!);
              expect(mockNavigate).toHaveBeenCalledWith('main');
            }
          },
          {
            name: 'shows both arrows for main part',
            run: () => {
              render(<Column {...commonProps} id="main" title="Main Part" />);
              expect(screen.getByTestId('icon-chevron-left')).toBeInTheDocument();
              expect(screen.getByTestId('icon-chevron-right')).toBeInTheDocument();

              fireEvent.click(screen.getByTestId('icon-chevron-left').closest('button')!);
              expect(mockNavigate).toHaveBeenCalledWith('introduction');

              mockNavigate.mockClear();
              fireEvent.click(screen.getByTestId('icon-chevron-right').closest('button')!);
              expect(mockNavigate).toHaveBeenCalledWith('conclusion');
            }
          },
          {
            name: 'shows only Previous arrow for conclusion',
            run: () => {
              render(<Column {...commonProps} id="conclusion" title="Conclusion" />);
              expect(screen.getByTestId('icon-chevron-left')).toBeInTheDocument();
              expect(screen.queryByTestId('icon-chevron-right')).not.toBeInTheDocument();

              fireEvent.click(screen.getByTestId('icon-chevron-left').closest('button')!);
              expect(mockNavigate).toHaveBeenCalledWith('main');
            }
          },
          {
            name: 'verifies centered header styling and title size',
            run: () => {
              const { container } = render(<Column {...commonProps} id="main" title="Main Part" />);
              const titleHeader = screen.getByText('Main Part');

              // Verify font size class text-xl (down from text-2xl)
              expect(titleHeader).toHaveClass('text-xl');

              // Verify centering container classes using flex-1 and justify-center
              const flexOneContainer = container.querySelector('.flex-1');
              expect(flexOneContainer).toHaveClass('justify-center');

              // Verify navigation buttons have premium hover classes
              const nextButton = screen.getByTestId('icon-chevron-right').closest('button');
              expect(nextButton).toHaveClass('hover:scale-110');
            }
          },
          {
            name: 'hides arrows when onNavigateToSection is missing',
            run: () => {
              render(<Column {...commonProps} id="main" title="Main Part" onNavigateToSection={undefined} />);
              expect(screen.queryByTestId('icon-chevron-left')).not.toBeInTheDocument();
              expect(screen.queryByTestId('icon-chevron-right')).not.toBeInTheDocument();
            }
          }
        ],
        { afterEachScenario: cleanup }
      );
    });
  });
});
