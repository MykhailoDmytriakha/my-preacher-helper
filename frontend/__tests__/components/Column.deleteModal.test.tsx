/**
 * Tests for the DeletePointConfirmModal behavior introduced in Column.tsx.
 * Uses a headlessui mock to avoid ref-forwarding issues in JSDOM.
 * Covers:
 *   - Lines 113-114: useEffect fires when isOpen transitions to true
 *   - Lines 830-837: handleDeletePoint (including onOutlinePointDeleted callback)
 *   - Lines 1876-1880: onConfirm callback body in the focus-mode DeletePointConfirmModal
 */

// --- headlessui mock (must be before imports) ---
jest.mock('@headlessui/react', () => {
  const React = require('react');
  const Fragment = React.Fragment;

  const TransitionChild = ({ children }: any) => React.createElement(Fragment, null, children);

  const Transition: any = ({ children }: any) => React.createElement(Fragment, null, children);
  Transition.Child = TransitionChild;

  const DialogPanel = ({ children, ...rest }: any) => React.createElement('div', rest, children);
  const DialogTitle = ({ as: As = 'h3', children, ...rest }: any) =>
    React.createElement(As, rest, children);

  const Dialog: any = ({ children, as: As = 'div', onClose: _onClose, ...rest }: any) =>
    React.createElement(As, { role: 'dialog', ...rest }, children);
  Dialog.Panel = DialogPanel;
  Dialog.Title = DialogTitle;

  return { Transition, Dialog };
});

// --- Shared component mocks ---
jest.mock('@heroicons/react/24/outline', () => {
  const mockIcon = (name: string) => (props: any) => {
    const React = require('react');
    return React.createElement('svg', { ...props, 'data-testid': `icon-${name}` });
  };
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
    ChevronRightIcon: mockIcon('chevron-right'),
    MicrophoneIcon: mockIcon('microphone'),
    ExclamationTriangleIcon: mockIcon('exclamation-triangle'),
  };
});

jest.mock('@dnd-kit/core', () => ({
  useDroppable: () => ({ setNodeRef: jest.fn(), isOver: false }),
}));

jest.mock('@dnd-kit/sortable', () => ({
  SortableContext: ({ children }: any) => {
    const React = require('react');
    return React.createElement('div', { 'data-testid': 'sortable-context' }, children);
  },
  verticalListSortingStrategy: jest.fn(),
}));

jest.mock('@hello-pangea/dnd', () => {
  const React = require('react');
  return {
    DragDropContext: ({ children }: any) => React.createElement('div', null, children),
    Droppable: ({ children }: any) =>
      React.createElement(
        'div',
        null,
        children({ innerRef: jest.fn(), droppableProps: {}, placeholder: null })
      ),
    Draggable: ({ children }: any) =>
      React.createElement(
        'div',
        null,
        children(
          { innerRef: jest.fn(), draggableProps: { style: {} }, dragHandleProps: {} },
          { isDragging: false }
        )
      ),
  };
});

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: any) => {
      const map: Record<string, string> = {
        'common.delete': 'Delete',
        'common.cancel': 'Cancel',
        'common.edit': 'Edit',
        'common.save': 'Save',
        'common.confirm': 'Confirm',
        'structure.deletePointConfirmTitle': 'Delete Outline Point',
        'structure.deletePointConfirmDesc': 'Type the name to confirm',
        'structure.addPointButton': 'Add outline point',
        'structure.addPointPlaceholder': 'Enter new outline point',
        'structure.editPointPlaceholder': 'Edit outline point',
      };
      return map[key] ?? options?.defaultValue ?? key;
    },
  }),
}));

jest.mock('sonner', () => ({ toast: { success: jest.fn(), error: jest.fn() } }));
jest.mock('@/hooks/useOnlineStatus', () => ({ useOnlineStatus: () => true }));
jest.mock('@/utils/debugMode', () => ({ debugLog: jest.fn() }));
jest.mock('@/utils/tagUtils', () => ({ getCanonicalTagForSection: jest.fn() }));

jest.mock('@/services/outline.service', () => ({
  updateSermonOutline: jest.fn(() => Promise.resolve({ success: true })),
  getSermonOutline: jest.fn(() => Promise.resolve({ introduction: [], main: [], conclusion: [] })),
  generateSermonPointsForSection: jest.fn(() => Promise.resolve([])),
}));

jest.mock('@/utils/themeColors', () => ({
  SERMON_SECTION_COLORS: {
    introduction: {
      base: '#d97706', light: '#f59e0b', dark: '#b45309',
      bg: 'bg-amber-50', darkBg: 'bg-amber-900/40',
      border: 'border-amber-200', darkBorder: 'border-amber-800',
      hover: 'hover:bg-amber-100', darkHover: 'hover:bg-amber-900/40',
      text: 'text-amber-800', darkText: 'text-amber-200',
    },
    mainPart: {
      base: '#2563eb', light: '#3b82f6', dark: '#1d4ed8',
      bg: 'bg-blue-50', darkBg: 'bg-blue-900/20',
      border: 'border-blue-200', darkBorder: 'border-blue-800',
      hover: 'hover:bg-blue-100', darkHover: 'hover:bg-blue-900/40',
      text: 'text-blue-800', darkText: 'text-blue-200',
    },
    conclusion: {
      base: '#16a34a', light: '#22c55e', dark: '#15803d',
      bg: 'bg-green-50', darkBg: 'bg-green-900/30',
      border: 'border-green-200', darkBorder: 'border-green-800',
      hover: 'hover:bg-green-100', darkHover: 'hover:bg-green-900/40',
      text: 'text-green-800', darkText: 'text-green-200',
    },
  },
  UI_COLORS: {
    neutral: { bg: 'bg-gray-50', darkBg: 'bg-gray-800', border: 'border-gray-200', darkBorder: 'border-gray-700', text: 'text-gray-800', darkText: 'text-gray-100' },
    muted: { text: 'text-gray-500', darkText: 'text-gray-400' },
    success: { bg: 'bg-green-50', darkBg: 'bg-green-900/30', border: 'border-green-300', darkBorder: 'border-green-800', text: 'text-green-800', darkText: 'text-green-200' },
  },
}));

jest.mock('react-markdown', () => (props: any) => {
  const React = require('react');
  return React.createElement(React.Fragment, null, props.children);
});
jest.mock('remark-gfm', () => ({}));

jest.mock('../../app/components/AudioRecorder', () => ({
  AudioRecorder: () => {
    const React = require('react');
    return React.createElement('div', { 'data-testid': 'audio-recorder' });
  },
}));

jest.mock('../../app/components/SortableItem', () => () => {
  const React = require('react');
  return React.createElement('div', { 'data-testid': 'sortable-item' });
});

jest.mock('../../app/components/ExportButtons', () => () => {
  const React = require('react');
  return React.createElement('div', { 'data-testid': 'export-buttons' });
});

jest.mock('../../app/components/FocusRecorderButton', () => ({
  FocusRecorderButton: () => {
    const React = require('react');
    return React.createElement('div', { 'data-testid': 'focus-recorder-button' });
  },
}));

jest.mock('@/components/Icons', () => ({
  MicrophoneIcon: (props: any) => {
    const React = require('react');
    return React.createElement('svg', { ...props, 'data-testid': 'microphone-icon' });
  },
  SwitchViewIcon: (props: any) => {
    const React = require('react');
    return React.createElement('svg', { ...props, 'data-testid': 'switch-view-icon' });
  },
}));

jest.mock('@/components/SermonGuidanceTooltips', () => ({
  OutlinePointGuidanceTooltip: () => null,
  SermonSectionGuidanceTooltip: () => null,
}));

// --- Actual test imports ---
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom';

import Column from '../../app/components/Column';
import { Item } from '@/models/models';
import { updateSermonOutline } from '@/services/outline.service';
import { toast } from 'sonner';

// ---------------------------------------------------------------------------

describe('Column — DeletePointConfirmModal behavior', () => {
  const focusProps = {
    title: 'Introduction',
    id: 'introduction',
    items: [] as Item[],
    showFocusButton: true,
    isFocusMode: true as const,
    onToggleFocusMode: jest.fn(),
  };

  const testPoint = { id: 'del-pt', text: 'Point To Delete' };

  afterEach(cleanup);

  it('opens confirmation modal when delete button is clicked (covers lines 113-114 useEffect)', async () => {
    render(
      <Column
        {...focusProps}
        outlinePoints={[testPoint]}
      />
    );

    // The delete button is in the focus sidebar (aria-label="Delete")
    await act(async () => {
      fireEvent.click(screen.getByLabelText('Delete'));
    });

    // Modal content is now accessible — DeletePointConfirmModal isOpen=true
    // The input has placeholder = pointName
    expect(screen.getByPlaceholderText('Point To Delete')).toBeInTheDocument();

    // The confirm button starts disabled (inputValue '' ≠ pointName)
    const dialog = screen.getByRole('dialog');
    const confirmBtn = within(dialog).getByRole('button', { name: 'Delete' });
    expect(confirmBtn).toBeDisabled();
  });

  it('enables confirm button when name matches and calls onOutlinePointDeleted on confirm (covers lines 830-837, 1876-1880)', async () => {
    const mockOnOutlinePointDeleted = jest.fn();

    render(
      <Column
        {...focusProps}
        outlinePoints={[testPoint]}
        onOutlinePointDeleted={mockOnOutlinePointDeleted}
      />
    );

    // Open the modal
    await act(async () => {
      fireEvent.click(screen.getByLabelText('Delete'));
    });

    const input = screen.getByPlaceholderText('Point To Delete');
    const dialog = screen.getByRole('dialog');
    const confirmBtn = within(dialog).getByRole('button', { name: 'Delete' });

    // Confirm is disabled until the name matches
    expect(confirmBtn).toBeDisabled();

    // Type the matching name
    fireEvent.change(input, { target: { value: 'Point To Delete' } });
    expect(confirmBtn).toBeEnabled();

    // Confirm the deletion
    await act(async () => {
      fireEvent.click(confirmBtn);
    });

    // onOutlinePointDeleted callback should have been called
    expect(mockOnOutlinePointDeleted).toHaveBeenCalledWith('del-pt', 'introduction');
  });
});

describe('Column — normal mode insert/edit flows', () => {
  const outlinePoints = [
    { id: 'p-1', text: 'Point one', isReviewed: false },
    { id: 'p-2', text: 'Point two', isReviewed: false },
  ];

  const baseProps = {
    id: 'introduction',
    title: 'Introduction',
    items: [] as Item[],
    outlinePoints,
    sermonId: 'sermon-123',
    isFocusMode: false as const,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    (updateSermonOutline as jest.Mock).mockResolvedValue({ success: true });
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
    cleanup();
  });

  it('saves direct inline edit from placeholder title click (covers 821-827)', async () => {
    render(<Column {...baseProps} />);

    const editablePointTitle = screen.getAllByText('Point one').find((el) => el.tagName.toLowerCase() === 'h4');
    expect(editablePointTitle).toBeDefined();
    fireEvent.click(editablePointTitle!);
    const editInput = screen.getByDisplayValue('Point one');
    fireEvent.change(editInput, { target: { value: 'Point one updated' } });
    fireEvent.keyDown(editInput, { key: 'Enter', code: 'Enter' });

    await act(async () => {
      jest.runOnlyPendingTimers();
    });

    expect(updateSermonOutline).toHaveBeenCalled();
    expect((updateSermonOutline as jest.Mock).mock.calls[0][1]).toEqual(
      expect.objectContaining({
        introduction: expect.arrayContaining([expect.objectContaining({ text: 'Point one updated' })]),
      })
    );
  });

  it('opens add-point composer and closes it on Escape and Cancel', () => {
    render(<Column {...baseProps} onAddOutlinePoint={jest.fn().mockResolvedValue(undefined)} />);

    fireEvent.click(screen.getByText('Add outline point'));
    const addInput = screen.getByPlaceholderText('New point name...');
    fireEvent.change(addInput, { target: { value: 'New point via add CTA' } });
    fireEvent.keyDown(addInput, { key: 'Escape', code: 'Escape' });
    expect(screen.queryByPlaceholderText('New point name...')).not.toBeInTheDocument();

    fireEvent.click(screen.getByText('Add outline point'));
    fireEvent.change(screen.getByPlaceholderText('New point name...'), { target: { value: 'Another point' } });
    const composerCancel = screen
      .getAllByRole('button', { name: 'Cancel' })
      .find((btn) => btn.className.includes('bg-gray-200'));
    expect(composerCancel).toBeDefined();
    fireEvent.click(composerCancel!);
    expect(screen.queryByPlaceholderText('New point name...')).not.toBeInTheDocument();
  });

  it('opens insert-between composer from divider and handles Escape/Cancel/Enter paths', async () => {
    const onAddOutlinePoint = jest.fn().mockResolvedValue(undefined);
    const { container } = render(<Column {...baseProps} onAddOutlinePoint={onAddOutlinePoint} />);

    const getDivider = () => container.querySelector('[class*="group/divider"]') as HTMLElement | null;
    expect(getDivider()).toBeInTheDocument();

    fireEvent.click(getDivider()!);
    let insertInput = screen.getByPlaceholderText('New point name...');
    fireEvent.keyDown(insertInput, { key: 'Escape', code: 'Escape' });
    expect(screen.queryByPlaceholderText('New point name...')).not.toBeInTheDocument();

    fireEvent.click(getDivider()!);
    insertInput = screen.getByPlaceholderText('New point name...');
    fireEvent.change(insertInput, { target: { value: 'Inserted point A' } });
    const composerCancel = screen
      .getAllByRole('button', { name: 'Cancel' })
      .find((btn) => btn.className.includes('bg-gray-200'));
    expect(composerCancel).toBeDefined();
    fireEvent.click(composerCancel!);
    expect(screen.queryByPlaceholderText('New point name...')).not.toBeInTheDocument();

    fireEvent.click(getDivider()!);
    insertInput = screen.getByPlaceholderText('New point name...');
    fireEvent.change(insertInput, { target: { value: 'Inserted point B' } });
    fireEvent.keyDown(insertInput, { key: 'Enter', code: 'Enter' });

    await waitFor(() => {
      expect(onAddOutlinePoint).toHaveBeenCalledWith('introduction', 1, 'Inserted point B');
    });
  });

  it('shows save toast error when add-outline callback rejects (covers 862-863)', async () => {
    const onAddOutlinePoint = jest.fn().mockRejectedValue(new Error('save failed'));
    render(<Column {...baseProps} onAddOutlinePoint={onAddOutlinePoint} />);

    fireEvent.click(screen.getByText('Add outline point'));
    const addInput = screen.getByPlaceholderText('New point name...');
    fireEvent.change(addInput, { target: { value: 'Rejected point' } });
    fireEvent.keyDown(addInput, { key: 'Enter', code: 'Enter' });

    await waitFor(() => {
      expect(onAddOutlinePoint).toHaveBeenCalled();
      expect(toast.error).toHaveBeenCalledWith('Failed to save outline point');
    });
  });
});
