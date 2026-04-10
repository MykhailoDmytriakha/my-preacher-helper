import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';

import '@testing-library/jest-dom';
import SortableItem, {
  getCardClassName,
  getHighlightStyles,
  getRemainingTime,
  getSectionIconClasses,
  HighlightBadge,
  SortableItemActions,
  SortableItemPreview,
  SyncMeta,
} from '@/components/SortableItem';

import { useSortable } from '@dnd-kit/sortable';

import { Item } from '@/models/models';

jest.mock('@dnd-kit/sortable', () => ({
  // This is the simple mock now
  useSortable: jest.fn().mockReturnValue({
    attributes: { role: 'button' },
    listeners: { onKeyDown: jest.fn() },
    setNodeRef: jest.fn(),
    transform: { x: 0, y: 0, scaleX: 1, scaleY: 1 },
    transition: 'transform 250ms ease-in-out',
    isDragging: false
  }),
  SortableContext: ({ children }: { children: React.ReactNode }) => <>{children}</>
}));

// Mock the CSS utility
jest.mock('@dnd-kit/utilities', () => ({
  CSS: {
    Transform: {
      toString: jest.fn(),
    },
  },
}));

// Mock the getContrastColor function
jest.mock('@/utils/color', () => ({
  getContrastColor: jest.fn().mockReturnValue('#ffffff'),
}));

// Mock the EditIcon and TrashIcon components
jest.mock('@components/Icons', () => {
  return {
    EditIcon: function MockEditIcon({ className = '' }: { className?: string }) {
      return <div data-testid="edit-icon" className={`mock-edit-icon ${className}`} />;
    },
    TrashIcon: function MockTrashIcon({ className = '' }: { className?: string }) {
      return <div data-testid="trash-icon" className={`mock-trash-icon ${className}`} />;
    }
  };
});

describe('SortableItem Component', () => {
  const mockItem: Item = {
    id: 'test-item-1',
    content: 'Test content for the item',
    customTagNames: [
      { name: 'Tag1', color: '#ff0000' },
      { name: 'Tag2', color: '#00ff00' },
    ],
    requiredTags: ['intro'],
  };

  const mockContainerId = 'introduction';
  const mockOnEdit = jest.fn();
  const mockOnDelete = jest.fn();
  const mockOnMoveToAmbiguous = jest.fn();
  const mockOnToggleLock = jest.fn();

  afterEach(() => {
    jest.clearAllMocks();
  });

  test('calls onEdit when edit button is clicked', () => {
    render(
      <SortableItem
        item={mockItem}
        containerId={mockContainerId}
        onEdit={mockOnEdit}
        onDelete={mockOnDelete}
      />
    );

    // Get the edit button by testId instead of role+name
    const editButton = screen.getByTestId('edit-icon').closest('button');
    fireEvent.click(editButton!);

    // Check if onEdit was called with the correct item
    expect(mockOnEdit).toHaveBeenCalledTimes(1);
    expect(mockOnEdit).toHaveBeenCalledWith(mockItem);
  });

  test('edit button has proper accessibility attributes', () => {
    render(
      <SortableItem
        item={mockItem}
        containerId={mockContainerId}
        onEdit={mockOnEdit}
        onDelete={mockOnDelete}
      />
    );

    // Get the edit button by testId instead of role+name
    const editButton = screen.getByTestId('edit-icon').closest('button');

    // Check for proper accessibility attributes
    expect(editButton).toHaveAttribute('title', 'structure.editThought');
    expect(editButton).toBeInTheDocument();
  });

  test('preserves line breaks in item content', () => {
    const itemWithLineBreaks: Item = {
      id: 'test-item-with-breaks',
      content: 'Line 1\nLine 2\nLine 3',
    };

    const { container } = render(
      <SortableItem
        item={itemWithLineBreaks}
        containerId={mockContainerId}
        onDelete={mockOnDelete}
      />
    );

    // Check if the content div has the prose class from MarkdownDisplay
    const contentDiv = container.querySelector('.prose');
    expect(contentDiv).toBeInTheDocument();

    // Check if the content is rendered
    // react-markdown will render this as a single paragraph with newlines collapsed to spaces by default,
    // or as multiple paragraphs if there were blank lines. 
    // toHaveTextContent automatically handles whitespace normalization.

    // Check if the content is rendered with preserved line breaks
    // Note: Browser rendering adds spaces when rendering newlines with whitespace-pre-wrap
    expect(contentDiv).toHaveTextContent('Line 1 Line 2 Line 3');
  });

  test('handles multiline content correctly in focus mode', () => {
    // Create a test item with multiple paragraphs and various whitespace
    const multilineContent = `First paragraph with some text.
    
Second paragraph with indentation.
  - Bullet point 1
  - Bullet point 2`;

    const itemWithMultilineContent: Item = {
      id: 'multiline-item',
      content: multilineContent,
    };

    const { container } = render(
      <SortableItem
        item={itemWithMultilineContent}
        containerId={mockContainerId}
        onDelete={mockOnDelete}
      />
    );

    // Check if the content div has the prose class
    const contentDiv = container.querySelector('.prose');
    expect(contentDiv).toBeInTheDocument();

    // Verify the content is rendered with proper whitespace preservation
    expect(contentDiv?.textContent).toBe(multilineContent);
  });

  test('does not render delete icon when showDeleteIcon is false or omitted', () => {
    render(
      <SortableItem
        item={mockItem}
        containerId={mockContainerId}
        onEdit={mockOnEdit}
        onDelete={mockOnDelete}
      />
    );
    expect(screen.queryByTestId('trash-icon')).not.toBeInTheDocument();

    // Explicitly set to false
    render(
      <SortableItem
        item={mockItem}
        containerId={mockContainerId}
        onEdit={mockOnEdit}
        showDeleteIcon={false}
        onDelete={mockOnDelete}
      />
    );
    expect(screen.queryByTestId('trash-icon')).not.toBeInTheDocument();
  });

  test('renders delete icon when showDeleteIcon is true', () => {
    render(
      <SortableItem
        item={mockItem}
        containerId={mockContainerId}
        onEdit={mockOnEdit}
        showDeleteIcon={true}
        onDelete={mockOnDelete}
      />
    );
    expect(screen.getByTestId('trash-icon')).toBeInTheDocument();
  });

  test('calls onDelete with correct arguments when delete button is clicked', () => {
    render(
      <SortableItem
        item={mockItem}
        containerId={mockContainerId}
        onEdit={mockOnEdit}
        onDelete={mockOnDelete}
        showDeleteIcon={true}
      />
    );

    // Find the delete button by testId instead of role+name
    const deleteButton = screen.getByTestId('trash-icon').closest('button');
    fireEvent.click(deleteButton!);

    expect(mockOnDelete).toHaveBeenCalledTimes(1);
    expect(mockOnDelete).toHaveBeenCalledWith(mockItem.id, mockContainerId);
  });

  test('delete button has proper accessibility attributes', () => {
    render(
      <SortableItem
        item={mockItem}
        containerId={mockContainerId}
        showDeleteIcon={true}
        onDelete={mockOnDelete}
      />
    );

    // Find the delete button by testId
    const deleteButton = screen.getByTestId('trash-icon').closest('button');
    expect(deleteButton).toHaveAttribute('title', 'structure.removeFromStructure');
    expect(deleteButton).toBeInTheDocument();
  });

  test('applies deleting styles and disables buttons when isDeleting is true', () => {
    render(
      <SortableItem
        item={mockItem}
        containerId={mockContainerId}
        onEdit={mockOnEdit}
        showDeleteIcon={true}
        onDelete={mockOnDelete}
        isDeleting={true}
      />
    );

    // Check container has expected style
    const container = screen.getByText('Test content for the item').closest('div[role="button"]') as HTMLElement | null;
    expect(container).toHaveClass('pointer-events-none');
    expect(container).toHaveStyle('opacity: 0.5');

    // Check buttons are disabled
    const editButton = screen.getByTestId('edit-icon').closest('button');
    expect(editButton).toBeDisabled();

    const deleteButton = screen.getByTestId('trash-icon').closest('button');
    expect(deleteButton).toBeDisabled();
  });

  test('disables drag affordances when item is locked/disabled', () => {
    render(
      <SortableItem
        item={mockItem}
        containerId={mockContainerId}
        onEdit={mockOnEdit}
        onDelete={mockOnDelete}
        disabled={true}
      />
    );

    const sortableMock = useSortable as jest.Mock;
    expect(sortableMock).toHaveBeenCalledWith(
      expect.objectContaining({ disabled: true, id: mockItem.id })
    );

    const container = screen.getByText('Test content for the item').closest('div[role="button"]') as HTMLElement | null;
    expect(container).toHaveAttribute('aria-disabled', 'true');
    expect(container?.className).toContain('cursor-default');
    expect(container?.className).toContain('min-h-[144px]');
    expect(container?.className).not.toContain('hover:shadow-xl');
    expect(container?.style.touchAction).toBe('auto');
  });

  test('keeps regular actions in the right rail outside AI review', () => {
    const { container } = render(
      <SortableItem
        item={mockItem}
        containerId={mockContainerId}
        onEdit={mockOnEdit}
        onDelete={mockOnDelete}
        onMoveToAmbiguous={mockOnMoveToAmbiguous}
        onToggleLock={mockOnToggleLock}
        showDeleteIcon={true}
      />
    );

    const card = screen.getByText('Test content for the item').closest('div[role="button"]') as HTMLElement | null;
    expect(card?.className).not.toContain('flex-col');
    expect(screen.queryByTestId(`sortable-item-footer-${mockItem.id}`)).not.toBeInTheDocument();

    const actions = screen.getByTestId(`sortable-item-actions-${mockItem.id}`);
    expect(actions).not.toHaveClass('absolute');
    expect(actions).toHaveClass('justify-self-end');
    expect(actions).toHaveClass('self-start');

    const grid = container.querySelector('.grid');
    expect(grid).toBeInTheDocument();
  });

  test('renders footer review controls only for highlighted AI items', () => {
    const { container } = render(
      <SortableItem
        item={mockItem}
        containerId={mockContainerId}
        isHighlighted={true}
        highlightType="moved"
        onKeep={jest.fn()}
        onRevert={jest.fn()}
      />
    );

    const footer = screen.getByTestId(`sortable-item-footer-${mockItem.id}`);
    expect(footer).toHaveClass('mt-3');
    expect(screen.getByText('structure.aiMoved')).toBeInTheDocument();
    expect(screen.getByTitle('structure.keepChanges')).toBeInTheDocument();
    expect(screen.getByTitle('structure.revertChanges')).toBeInTheDocument();
    expect(container.querySelector('.pb-16')).not.toBeInTheDocument();
  });

  test('renders lock controls and toggles lock state', () => {
    render(
      <SortableItem
        item={mockItem}
        containerId={mockContainerId}
        onToggleLock={mockOnToggleLock}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'structure.lockThought' }));
    expect(mockOnToggleLock).toHaveBeenCalledWith(mockItem.id, true);
  });

  test('shows locked state and unlock action for locked thoughts', () => {
    render(
      <SortableItem
        item={{ ...mockItem, isLocked: true }}
        containerId={mockContainerId}
        onToggleLock={mockOnToggleLock}
        isLocked={true}
      />
    );

    const container = screen.getByText('Test content for the item').closest('div[role="button"]') as HTMLElement | null;
    expect(container).not.toHaveAttribute('aria-disabled', 'true');
    expect(container).toHaveClass('bg-slate-50');

    const toggleButton = screen.getByRole('button', { name: 'structure.unlockThought' });
    expect(toggleButton).toHaveAttribute('aria-pressed', 'true');
    expect(toggleButton).toHaveAttribute('data-state', 'locked');
    expect(screen.queryByText('structure.locked')).not.toBeInTheDocument();

    fireEvent.click(toggleButton);
    expect(mockOnToggleLock).toHaveBeenCalledWith(mockItem.id, false);
  });

  test('uses the lock button itself as the visible unlocked state', () => {
    render(
      <SortableItem
        item={mockItem}
        containerId={mockContainerId}
        onToggleLock={mockOnToggleLock}
      />
    );

    const container = screen.getByText('Test content for the item').closest('div[role="button"]') as HTMLElement | null;
    expect(container).not.toHaveClass('bg-slate-50');

    const toggleButton = screen.getByRole('button', { name: 'structure.lockThought' });
    expect(toggleButton).toHaveAttribute('aria-pressed', 'false');
    expect(toggleButton).toHaveAttribute('data-state', 'unlocked');
  });

  test('renders move-to-ambiguous button and triggers handler', () => {
    render(
      <SortableItem
        item={mockItem}
        containerId={mockContainerId}
        onEdit={mockOnEdit}
        onDelete={mockOnDelete}
        onMoveToAmbiguous={mockOnMoveToAmbiguous}
      />
    );

    // Button should be present with i18n key title
    const moveBtn = screen.getByTitle('structure.moveToUnderConsideration');
    expect(moveBtn).toBeInTheDocument();

    // Click it
    fireEvent.click(moveBtn);
    expect(mockOnMoveToAmbiguous).toHaveBeenCalledTimes(1);
    expect(mockOnMoveToAmbiguous).toHaveBeenCalledWith(mockItem.id, mockContainerId);
  });

  test('renders buttons in the correct order (edit then move-to-ambiguous)', () => {
    render(
      <SortableItem
        item={mockItem}
        containerId={mockContainerId}
        onEdit={mockOnEdit}
        onMoveToAmbiguous={mockOnMoveToAmbiguous}
      />
    );

    const editBtn = screen.getByTitle('structure.editThought');
    const moveBtn = screen.getByTitle('structure.moveToUnderConsideration');

    // Edit button should come before move button in DOM
    const editBtnPosition = editBtn.compareDocumentPosition(moveBtn);
    expect(editBtnPosition).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  test('does not render move button in ambiguous container', () => {
    render(
      <SortableItem
        item={mockItem}
        containerId="ambiguous"
        onEdit={mockOnEdit}
        onDelete={mockOnDelete}
        onMoveToAmbiguous={mockOnMoveToAmbiguous}
      />
    );

    expect(screen.queryByTitle('structure.moveToUnderConsideration')).not.toBeInTheDocument();
  });

  test('applies section color classes to move and edit icons for main section', () => {
    render(
      <SortableItem
        item={mockItem}
        containerId="main"
        onEdit={mockOnEdit}
        onDelete={mockOnDelete}
        onMoveToAmbiguous={mockOnMoveToAmbiguous}
      />
    );

    // Move icon lives inside the move button
    const moveBtn = screen.getByTitle('structure.moveToUnderConsideration');
    const moveIcon = moveBtn.querySelector('svg');
    expect(moveIcon?.getAttribute('class') || '').toContain('text-blue-800');

    // Edit icon mock forwards className; ensure it contains section color class
    const editIcon = screen.getByTestId('edit-icon');
    expect(editIcon).toHaveClass('text-blue-800');
  });

  test('covers conclusion and fallback icon color branches', () => {
    const { rerender } = render(
      <SortableItem
        item={mockItem}
        containerId="conclusion"
        onEdit={mockOnEdit}
        onMoveToAmbiguous={mockOnMoveToAmbiguous}
      />
    );

    expect(screen.getByTestId('edit-icon')).toHaveClass('text-green-800');
    expect(screen.getByTitle('structure.moveToUnderConsideration').querySelector('svg')?.getAttribute('class') || '').toContain('text-green-800');

    rerender(
      <SortableItem
        item={mockItem}
        containerId="custom-container"
        onEdit={mockOnEdit}
        onMoveToAmbiguous={mockOnMoveToAmbiguous}
      />
    );

    expect(screen.getByTestId('edit-icon')).toHaveClass('text-gray-600');
  });

  test('renders sync meta states and retries failed sync items', () => {
    const retrySpy = jest.fn();
    const now = new Date('2026-03-18T10:00:00.000Z').getTime();
    jest.spyOn(Date, 'now').mockReturnValue(now);

    const { rerender } = render(
      <SortableItem
        item={{
          ...mockItem,
          syncStatus: 'pending',
          syncExpiresAt: new Date(now + 30_000).toISOString(),
        }}
        containerId={mockContainerId}
        onRetrySync={retrySpy}
      />
    );

    expect(screen.getByText('structure.localThoughtPending')).toBeInTheDocument();

    rerender(
      <SortableItem
        item={{
          ...mockItem,
          syncStatus: 'error',
          syncExpiresAt: new Date(now + 30_000).toISOString(),
        }}
        containerId={mockContainerId}
        onRetrySync={retrySpy}
      />
    );

    expect(screen.getByText('structure.localThoughtFailed')).toBeInTheDocument();
    fireEvent.click(screen.getByTitle('structure.localThoughtRetry'));
    expect(retrySpy).toHaveBeenCalledWith(mockItem.id);

    jest.restoreAllMocks();
  });

  test('invokes keep and revert actions for highlighted items', () => {
    const keepSpy = jest.fn();
    const revertSpy = jest.fn();

    render(
      <SortableItem
        item={mockItem}
        containerId={mockContainerId}
        isHighlighted={true}
        highlightType="moved"
        onKeep={keepSpy}
        onRevert={revertSpy}
      />
    );

    fireEvent.click(screen.getByTitle('structure.keepChanges'));
    fireEvent.click(screen.getByTitle('structure.revertChanges'));

    expect(keepSpy).toHaveBeenCalledWith(mockItem.id, mockContainerId);
    expect(revertSpy).toHaveBeenCalledWith(mockItem.id, mockContainerId);
  });

  test('renders preview overlay and keeps overlay controls non-interactive', () => {
    render(
      <SortableItemPreview
        item={{ ...mockItem, isLocked: true }}
        containerId="conclusion"
        isLocked={true}
      />
    );

    const container = screen.getByText('Test content for the item').closest('div[aria-disabled="true"]') as HTMLElement | null;
    expect(container?.className).not.toContain('mb-6');
    expect(container).toHaveAttribute('aria-disabled', 'true');
    expect(screen.queryByTitle('structure.lockThought')).not.toBeInTheDocument();
    expect(screen.queryByTitle('structure.unlockThought')).not.toBeInTheDocument();
  });

  test('renders only a compact subpoint chip when nested context is provided', () => {
    render(
      <SortableItem
        item={mockItem}
        containerId={mockContainerId}
        locationContext={{ subPointText: 'Faith steps' }}
      />
    );

    expect(screen.getByTestId('thought-location-chip')).toHaveTextContent('Faith steps');
    expect(screen.queryByText(/Main Point/)).not.toBeInTheDocument();
  });

  test('applies assigned highlight classes on card and badge', () => {
    render(
      <SortableItem
        item={mockItem}
        containerId={mockContainerId}
        onEdit={mockOnEdit}
        isHighlighted={true}
        highlightType="assigned"
      />
    );

    const container = screen.getByText('Test content for the item').closest('div[role="button"]') as HTMLElement | null;
    expect(container).toBeInTheDocument();
    expect(container?.className).toContain('border-yellow-400');
    expect(container?.className).toContain('shadow-yellow-200');
    expect(container).toHaveStyle({ borderColor: 'rgb(250, 204, 21)', backgroundColor: 'rgb(254, 249, 195)' });

    const badge = screen.getByText('structure.aiAssigned');
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveClass('text-yellow-800');
  });

  test('applies moved highlight badge class variant', () => {
    render(
      <SortableItem
        item={mockItem}
        containerId={mockContainerId}
        onEdit={mockOnEdit}
        isHighlighted={true}
        highlightType="moved"
      />
    );

    const badge = screen.getByText('structure.aiMoved');
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveClass('text-blue-800');

    const container = screen.getByText('Test content for the item').closest('div[role="button"]') as HTMLElement | null;
    expect(container).toHaveStyle({ borderColor: 'rgb(59, 130, 246)', backgroundColor: 'rgb(219, 234, 254)' });
  });

  test('covers exported helper branches directly', () => {
    expect(getHighlightStyles(true, 'assigned')).toEqual({
      borderColor: 'rgb(250, 204, 21)',
      backgroundColor: 'rgb(254, 249, 195)',
    });
    expect(getHighlightStyles(true, 'moved')).toEqual({
      borderColor: 'rgb(59, 130, 246)',
      backgroundColor: 'rgb(219, 234, 254)',
    });
    expect(getSectionIconClasses('conclusion')).toContain('text-green-800');
    expect(getSectionIconClasses('custom')).toBe('text-gray-600 dark:text-gray-300');
    expect(getRemainingTime('2026-03-18T10:01:01.000Z', new Date('2026-03-18T10:00:00.000Z').getTime())).toBe('01:01');

    expect(getCardClassName({
      isHighlighted: false,
      highlightType: 'moved',
      syncBorderClass: '',
      syncRingClass: '',
      hoverShadowClass: '',
      isDeleting: false,
      isDragDisabled: false,
      cursorClass: 'cursor-grab',
      isOverlay: false,
      isLocked: true,
    })).toContain('bg-slate-50');

    expect(getCardClassName({
      isHighlighted: true,
      highlightType: 'assigned',
      syncBorderClass: '',
      syncRingClass: '',
      hoverShadowClass: '',
      isDeleting: false,
      isDragDisabled: false,
      cursorClass: 'cursor-grab',
      isOverlay: false,
      isLocked: false,
    })).toContain('border-yellow-400');
  });

  test('renders exported badge helpers for assigned, moved, pending, and error states', () => {
    const t = (key: string) => key;
    const { rerender } = render(
      <HighlightBadge
        isHighlighted={true}
        highlightType="assigned"
        t={t}
      />
    );

    expect(screen.getByText('structure.aiAssigned')).toHaveClass('text-yellow-800');

    rerender(
      <HighlightBadge
        isHighlighted={true}
        highlightType="moved"
        t={t}
      />
    );

    expect(screen.getByText('structure.aiMoved')).toHaveClass('text-blue-800');

    rerender(
      <SyncMeta
        show={true}
        isError={true}
        remainingTime="00:30"
        t={t}
      />
    );

    expect(screen.getByText('structure.localThoughtFailed')).toBeInTheDocument();

    rerender(
      <SyncMeta
        show={true}
        isError={false}
        remainingTime="00:30"
        t={t}
      />
    );

    expect(screen.getByText('structure.localThoughtPending')).toBeInTheDocument();
  });

  test('renders exported actions branches for locked and unlocked lock controls', () => {
    const t = (key: string) => key;
    const { rerender } = render(
      <SortableItemActions
        item={mockItem}
        containerId={mockContainerId}
        isHighlighted={true}
        isDragging={false}
        isDeleting={false}
        isPending={false}
        isError={false}
        isSuccess={false}
        isLocal={false}
        canEdit={false}
        isLocked={true}
        mutationDisabled={false}
        canToggleLock={true}
        showDeleteIcon={false}
        sectionIconColorClasses="text-blue-800"
        successOpacityClass=""
        t={t}
        isOverlay={false}
      />
    );

    const unlockButton = screen.getByRole('button', { name: 'structure.unlockThought' });
    expect(unlockButton).toHaveAttribute('aria-pressed', 'true');
    expect(unlockButton.className).toContain('bg-slate-200');
    expect(unlockButton.querySelector('svg')?.getAttribute('class') || '').toContain('h-5 w-5');

    rerender(
      <SortableItemActions
        item={mockItem}
        containerId={mockContainerId}
        isHighlighted={false}
        isDragging={false}
        isDeleting={false}
        isPending={false}
        isError={false}
        isSuccess={false}
        isLocal={false}
        canEdit={false}
        isLocked={false}
        mutationDisabled={false}
        canToggleLock={true}
        showDeleteIcon={false}
        sectionIconColorClasses="text-blue-800"
        successOpacityClass=""
        t={t}
        isOverlay={false}
      />
    );

    const lockButton = screen.getByRole('button', { name: 'structure.lockThought' });
    expect(lockButton).toHaveAttribute('aria-pressed', 'false');
    expect(lockButton.className).toContain('bg-white');
    expect(lockButton.querySelector('svg')?.getAttribute('class') || '').toContain('text-blue-800');
  });
});
