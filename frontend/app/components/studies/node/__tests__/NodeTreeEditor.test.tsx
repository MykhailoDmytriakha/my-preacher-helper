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

jest.mock('@components/MarkdownDisplay', () => ({
  __esModule: true,
  default: ({ content }: { content: string }) => (
    <div data-testid="markdown-display">{content}</div>
  ),
}));

function makeRoot(children: ContentNode[]): ContentNode {
  return {
    id: 'root',
    header: 'Root',
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

function renderEditor(rootNode: ContentNode, onChange = jest.fn()) {
  render(<NodeTreeEditor rootNode={rootNode} onChange={onChange} />);
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
    expect(screen.getByLabelText('Текст ноды')).toBeInTheDocument();

    screen.getByLabelText('Текст ноды').focus();
    fireEvent.keyDown(editor, { key: 'Escape' });

    expect(screen.queryByLabelText('Текст ноды')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Click here to start' })).toBeInTheDocument();
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
});
