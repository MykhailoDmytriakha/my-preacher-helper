import { fireEvent, render, screen } from '@testing-library/react';

import { ContentNode } from '@/models/models';

import NodeView from '../NodeView';

jest.mock('@components/MarkdownDisplay', () => ({
  __esModule: true,
  default: ({ content }: { content: string }) => (
    <div data-testid="markdown-display">{content}</div>
  ),
}));

const defaultHandlers = {
  onFocus: jest.fn(),
  onStartEdit: jest.fn(),
  onStopEdit: jest.fn(),
  onHeaderChange: jest.fn(),
  onTextChange: jest.fn(),
  onToggleCollapse: jest.fn(),
  onMediaRemove: jest.fn(),
  onMediaAdd: jest.fn(),
  onAddChild: jest.fn(),
  onAddSibling: jest.fn(),
  onMoveUp: jest.fn(),
  onMoveDown: jest.fn(),
  onDemote: jest.fn(),
  onPromote: jest.fn(),
  onDeleteNode: jest.fn(),
  onSplitFromMarkdown: jest.fn(),
};

function renderNodeView(
  node: ContentNode,
  overrides: Partial<React.ComponentProps<typeof NodeView>> = {}
) {
  const props: React.ComponentProps<typeof NodeView> = {
    node,
    depth: 0,
    isFocused: false,
    isEditing: false,
    showActions: false,
    isRoot: false,
    hasChildren: false,
    isCollapsed: false,
    ...defaultHandlers,
    ...overrides,
  };

  return render(<NodeView {...props} />);
}

describe('NodeView', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders header at the correct depth', () => {
    const { rerender } = renderNodeView({ id: 'root', header: 'Root title' });

    expect(screen.getByRole('heading', { level: 1, name: 'Root title' })).toBeInTheDocument();

    rerender(
      <NodeView
        node={{ id: 'child', header: 'Child title' }}
        depth={1}
        isFocused={false}
        isEditing={false}
        showActions={false}
        isRoot={false}
        hasChildren={false}
        isCollapsed={false}
        {...defaultHandlers}
      />
    );

    expect(screen.getByRole('heading', { level: 2, name: 'Child title' })).toBeInTheDocument();
  });

  it('renders text through MarkdownDisplay', () => {
    renderNodeView({ id: 'text-node', text: '**Bold text**' });

    expect(screen.getByTestId('markdown-display')).toHaveTextContent('**Bold text**');
  });

  it('renders image media as an image element', () => {
    renderNodeView({
      id: 'image-node',
      media: [{ id: 'image-1', type: 'image', url: 'https://example.com/image.jpg', caption: 'Image caption' }],
    });

    const image = screen.getByRole('img', { name: 'Image caption' });
    expect(image).toHaveAttribute('src', 'https://example.com/image.jpg');
  });

  it('renders a YouTube thumbnail using the extracted video id', () => {
    renderNodeView({
      id: 'youtube-node',
      media: [{ id: 'youtube-1', type: 'youtube', url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', caption: 'Video' }],
    });

    expect(screen.getByRole('img', { name: 'Video' })).toHaveAttribute(
      'src',
      'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg'
    );
  });

  it('applies the focus ring when focused', () => {
    renderNodeView({ id: 'focused-node', header: 'Focused' }, { isFocused: true });

    expect(screen.getByTestId('node-view-focused-node')).toHaveClass('ring-2');
    expect(screen.getByTestId('node-view-focused-node')).toHaveClass('ring-emerald-400');
  });

  it('calls onFocus when the row is clicked', () => {
    renderNodeView({ id: 'click-node', header: 'Click me' });

    fireEvent.click(screen.getByTestId('node-view-click-node'));

    expect(defaultHandlers.onFocus).toHaveBeenCalledTimes(1);
  });

  it('calls onToggleCollapse when the chevron is clicked', () => {
    renderNodeView(
      { id: 'parent-node', header: 'Parent' },
      { hasChildren: true }
    );

    fireEvent.click(screen.getByRole('button', { name: 'Collapse node' }));

    expect(defaultHandlers.onToggleCollapse).toHaveBeenCalledTimes(1);
  });

  it('applies drag handle props to the handle button without focusing the row', () => {
    renderNodeView(
      { id: 'drag-node', header: 'Drag me' },
      {
        dragHandleProps: {
          'aria-describedby': 'sortable-description',
          onPointerDown: defaultHandlers.onMoveUp,
        },
      }
    );

    const handle = screen.getByTestId('drag-handle-drag-node');
    expect(handle).toHaveAttribute('aria-describedby', 'sortable-description');

    fireEvent.pointerDown(handle);
    fireEvent.click(handle);

    expect(defaultHandlers.onMoveUp).toHaveBeenCalledTimes(1);
    expect(defaultHandlers.onFocus).not.toHaveBeenCalled();
  });

  it('renders the delete button in edit mode for a non-root node', () => {
    renderNodeView(
      { id: 'delete-node', text: 'Body' },
      { isEditing: true }
    );

    expect(screen.getByRole('button', { name: 'Delete node' })).toBeInTheDocument();
  });

  it('does not render the delete button for the root node', () => {
    renderNodeView(
      { id: 'root', text: 'Root body' },
      { isEditing: true, isRoot: true }
    );

    expect(screen.queryByRole('button', { name: 'Delete node' })).not.toBeInTheDocument();
  });

  it('deletes an empty leaf immediately without confirmation', () => {
    const confirmSpy = jest.spyOn(window, 'confirm').mockReturnValue(true);

    renderNodeView(
      { id: 'empty-leaf' },
      { isEditing: true }
    );

    fireEvent.click(screen.getByRole('button', { name: 'Delete node' }));

    expect(defaultHandlers.onDeleteNode).toHaveBeenCalledTimes(1);
    expect(confirmSpy).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });

  it('confirms before deleting a non-empty node', () => {
    const confirmSpy = jest.spyOn(window, 'confirm').mockReturnValue(true);

    renderNodeView(
      { id: 'non-empty', text: 'Body' },
      { isEditing: true }
    );

    fireEvent.click(screen.getByRole('button', { name: 'Delete node' }));

    expect(confirmSpy).toHaveBeenCalledWith('Delete node?');
    expect(defaultHandlers.onDeleteNode).toHaveBeenCalledTimes(1);
    confirmSpy.mockRestore();
  });

  it('shows actions for a focused node without opening the text textarea', () => {
    renderNodeView(
      { id: 'focused-actions', text: '**Preview**' },
      { isFocused: true, showActions: true, isEditing: false }
    );

    expect(screen.getByRole('button', { name: 'Delete node' })).toBeInTheDocument();
    expect(screen.getByText('Дочерняя')).toBeInTheDocument();
    expect(screen.queryByLabelText('Текст ноды')).not.toBeInTheDocument();
    expect(screen.getByTestId('markdown-display')).toHaveTextContent('**Preview**');
  });
});
