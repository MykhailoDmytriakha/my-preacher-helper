import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

import { ContentNode } from '@/models/models';

import NodeTreeEditor from '../NodeTreeEditor';

import type { DragEndEvent } from '@dnd-kit/core';
import type { ReactNode } from 'react';

type CapturedDndContextProps = {
  children?: ReactNode;
  onDragEnd?: (event: DragEndEvent) => void;
};

let mockDndContextProps: CapturedDndContextProps | null = null;

jest.mock('@dnd-kit/core', () => ({
  DndContext: (props: CapturedDndContextProps) => {
    mockDndContextProps = props;
    return <div data-testid="dnd-context">{props.children}</div>;
  },
  PointerSensor: jest.fn(),
  TouchSensor: jest.fn(),
  closestCenter: jest.fn(),
  useSensor: jest.fn((sensor: unknown, options: unknown) => ({ sensor, options })),
  useSensors: jest.fn((...sensors: unknown[]) => sensors),
}));

jest.mock('@dnd-kit/sortable', () => ({
  SortableContext: ({ children }: { children: ReactNode }) => (
    <div data-testid="sortable-context">{children}</div>
  ),
  useSortable: jest.fn(() => ({
    attributes: {},
    listeners: {},
    setNodeRef: jest.fn(),
    transform: null,
    transition: undefined,
    isDragging: false,
  })),
  verticalListSortingStrategy: jest.fn(),
}));

jest.mock('@dnd-kit/utilities', () => ({
  CSS: {
    Transform: {
      toString: () => '',
    },
  },
}));

jest.mock('@/hooks/useWikilinkResolver', () => ({
  useWikilinkResolver: () => () => undefined,
}));

jest.mock('@components/MarkdownDisplay', () => ({
  __esModule: true,
  default: ({ content }: { content: string }) => (
    <div data-testid="markdown-display">{content}</div>
  ),
}));

function makeRoot(children: ContentNode[]): ContentNode {
  // Root is a pure structural wrapper — no header/text/media. (If a fixture
  // ever needs a top-level title, put it on a real first child.) Putting
  // content on root here would trigger `liftRootContent` migration and shift
  // children right by one, breaking the test expectations that index by `a`.
  return {
    id: 'root',
    children,
  };
}

function getLastChangedRoot(onChange: jest.Mock): ContentNode {
  return onChange.mock.calls[onChange.mock.calls.length - 1][0] as ContentNode;
}

function mockRandomIds(...ids: string[]): void {
  const randomUUID = jest.fn();
  ids.forEach((id) => randomUUID.mockReturnValueOnce(id));
  Object.defineProperty(globalThis, 'crypto', {
    configurable: true,
    value: { randomUUID },
  });
}

function renderEditor(rootNode: ContentNode, onChange = jest.fn(), readOnly = false) {
  render(<NodeTreeEditor rootNode={rootNode} onChange={onChange} readOnly={readOnly} />);
  const editor = screen.getByTestId('node-tree-editor');

  return { editor, onChange };
}

describe('NodeTreeEditor', () => {
  beforeEach(() => {
    mockDndContextProps = null;
    mockRandomIds('generated-1', 'generated-2', 'generated-3');
  });

  it('inserts a sibling with Enter', async () => {
    const { editor, onChange } = renderEditor(makeRoot([{ id: 'a', header: 'A' }]));

    fireEvent.click(screen.getByTestId('node-view-a'));
    fireEvent.keyDown(editor, { key: 'Enter' });

    await waitFor(() => expect(onChange).toHaveBeenCalled());
    expect(getLastChangedRoot(onChange).children?.map((child) => child.id)).toEqual(['a', 'generated-1']);
  });

  it('shows the full action row after a single focus click without text editing', () => {
    renderEditor(makeRoot([{ id: 'a', text: '**Preview**' }]));

    expect(screen.queryByText('Дочерняя')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('node-view-a'));

    expect(screen.getByText('Дочерняя')).toBeInTheDocument();
    expect(screen.getByTestId('markdown-display')).toHaveTextContent('**Preview**');
    expect(screen.queryByLabelText('Текст ноды')).not.toBeInTheDocument();
  });

  it('inserts a child with Cmd+Enter', async () => {
    const { editor, onChange } = renderEditor(makeRoot([{ id: 'a', header: 'A' }]));

    fireEvent.click(screen.getByTestId('node-view-a'));
    fireEvent.keyDown(editor, { key: 'Enter', metaKey: true });

    await waitFor(() => expect(onChange).toHaveBeenCalled());
    expect(getLastChangedRoot(onChange).children?.[0].children?.map((child) => child.id)).toEqual(['generated-1']);
  });

  it('demotes the focused node with Tab', async () => {
    const { editor, onChange } = renderEditor(makeRoot([
      { id: 'a', header: 'A' },
      { id: 'b', header: 'B' },
    ]));

    fireEvent.click(screen.getByTestId('node-view-b'));
    fireEvent.keyDown(editor, { key: 'Tab' });

    await waitFor(() => expect(onChange).toHaveBeenCalled());
    const root = getLastChangedRoot(onChange);
    expect(root.children?.map((child) => child.id)).toEqual(['a']);
    expect(root.children?.[0].children?.map((child) => child.id)).toEqual(['b']);
  });

  it('promotes the focused node with Shift+Tab', async () => {
    const { editor, onChange } = renderEditor(makeRoot([
      { id: 'a', header: 'A', children: [{ id: 'b', header: 'B' }] },
    ]));

    fireEvent.click(screen.getByTestId('node-view-b'));
    fireEvent.keyDown(editor, { key: 'Tab', shiftKey: true });

    await waitFor(() => expect(onChange).toHaveBeenCalled());
    expect(getLastChangedRoot(onChange).children?.map((child) => child.id)).toEqual(['a', 'b']);
  });

  it('moves the focused node up with Cmd+ArrowUp', async () => {
    const { editor, onChange } = renderEditor(makeRoot([
      { id: 'a', header: 'A' },
      { id: 'b', header: 'B' },
    ]));

    fireEvent.click(screen.getByTestId('node-view-b'));
    fireEvent.keyDown(editor, { key: 'ArrowUp', metaKey: true });

    await waitFor(() => expect(onChange).toHaveBeenCalled());
    expect(getLastChangedRoot(onChange).children?.map((child) => child.id)).toEqual(['b', 'a']);
  });

  it('moves the focused node down with Cmd+ArrowDown', async () => {
    const { editor, onChange } = renderEditor(makeRoot([
      { id: 'a', header: 'A' },
      { id: 'b', header: 'B' },
    ]));

    fireEvent.click(screen.getByTestId('node-view-a'));
    fireEvent.keyDown(editor, { key: 'ArrowDown', metaKey: true });

    await waitFor(() => expect(onChange).toHaveBeenCalled());
    expect(getLastChangedRoot(onChange).children?.map((child) => child.id)).toEqual(['b', 'a']);
  });

  it('deletes an empty focused leaf with Backspace', async () => {
    const { editor, onChange } = renderEditor(makeRoot([{ id: 'empty-leaf' }]));

    fireEvent.click(screen.getByTestId('node-view-empty-leaf'));
    fireEvent.keyDown(editor, { key: 'Backspace' });

    await waitFor(() => expect(onChange).toHaveBeenCalled());
    expect(getLastChangedRoot(onChange).children).toBeUndefined();
  });

  it('exits edit mode with Escape', () => {
    const { editor } = renderEditor({ id: 'root' });

    fireEvent.click(screen.getByRole('button', { name: 'Click here to start' }));
    // Edit mode shows the header textarea; the text body is now a tiptap
    // contenteditable, so we key off the header textarea as the edit-mode
    // marker instead of the old "Текст ноды" textarea label.
    expect(screen.getByLabelText('Заголовок ноды')).toBeInTheDocument();

    screen.getByLabelText('Заголовок ноды').focus();
    fireEvent.keyDown(editor, { key: 'Escape' });

    // Editor exits edit mode; the empty child created by "Click here to start"
    // stays in the tree (now hidden behind a non-focused row), so the empty-
    // tree placeholder doesn't re-appear.
    expect(screen.queryByLabelText('Заголовок ноды')).not.toBeInTheDocument();
  });

  it('calls onChange with the new tree after a keyboard action', async () => {
    const { editor, onChange } = renderEditor(makeRoot([{ id: 'a', header: 'A' }]));

    fireEvent.click(screen.getByTestId('node-view-a'));
    fireEvent.keyDown(editor, { key: 'Enter' });

    await waitFor(() => expect(onChange).toHaveBeenCalledTimes(1));
    expect(getLastChangedRoot(onChange)).toMatchObject({
      id: 'root',
      children: [{ id: 'a' }, { id: 'generated-1' }],
    });
  });

  it('does not insert a sibling when Enter fires from a contenteditable activeElement in edit mode', async () => {
    // Tiptap renders the text body as a contenteditable <div>. Without the
    // isContentEditable branch in isInteractiveTextEditor, Enter inside the
    // rich editor would bubble up to the tree shortcut and split the node.
    const { editor, onChange } = renderEditor(makeRoot([{ id: 'empty-leaf' }]));

    // Click the empty leaf — empty + focused auto-starts edit mode
    // (NodeView line 264-267), so state.isEditingText becomes true.
    fireEvent.click(screen.getByTestId('node-view-empty-leaf'));

    // Simulate the synthetic contenteditable host that tiptap mounts.
    const contentEditableDiv = document.createElement('div');
    contentEditableDiv.setAttribute('contenteditable', 'true');
    // jsdom needs an explicit isContentEditable hook because the
    // contenteditable attribute alone doesn't flip the IDL property there.
    Object.defineProperty(contentEditableDiv, 'isContentEditable', {
      configurable: true,
      get: () => true,
    });
    document.body.appendChild(contentEditableDiv);
    Object.defineProperty(document, 'activeElement', {
      configurable: true,
      get: () => contentEditableDiv,
    });

    try {
      fireEvent.keyDown(editor, { key: 'Enter' });
    } finally {
      // Restore activeElement so subsequent tests aren't affected.
      delete (document as unknown as { activeElement?: Element }).activeElement;
      contentEditableDiv.remove();
    }

    // No tree mutation: insertSibling did NOT dispatch.
    expect(onChange).not.toHaveBeenCalled();
  });

  it('moves a node through the dnd-kit drag end wiring', async () => {
    const { onChange } = renderEditor(makeRoot([
      { id: 'a', header: 'A' },
      { id: 'b', header: 'B' },
    ]));

    act(() => {
      mockDndContextProps?.onDragEnd?.({
        activatorEvent: new Event('pointerup'),
        active: { id: 'b' },
        collisions: null,
        over: { id: 'a' },
        delta: { x: 0, y: -20, scaleX: 1, scaleY: 1 },
      } as unknown as DragEndEvent);
    });

    await waitFor(() => expect(onChange).toHaveBeenCalled());
    expect(getLastChangedRoot(onChange).children?.map((child) => child.id)).toEqual(['b', 'a']);
  });

  it('does not emit onChange in read-only mode when the rootNode prop changes', async () => {
    const onChange = jest.fn();
    const firstRoot = makeRoot([{ id: 'a', header: 'A' }]);
    const nextRoot = makeRoot([{ id: 'b', header: 'B' }]);
    const { rerender } = render(
      <NodeTreeEditor rootNode={firstRoot} onChange={onChange} readOnly />
    );

    expect(await screen.findByRole('heading', { name: 'A' })).toBeInTheDocument();

    rerender(<NodeTreeEditor rootNode={nextRoot} onChange={onChange} readOnly />);

    expect(await screen.findByRole('heading', { name: 'B' })).toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });
});
