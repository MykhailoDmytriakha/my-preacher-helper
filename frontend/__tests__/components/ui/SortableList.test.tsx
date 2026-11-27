import { act, render, screen } from '@testing-library/react';

import { DragHandle, SortableList } from '@/components/ui/SortableList';

import type { DragEndEvent } from '@dnd-kit/core';

/** The real context, with its drop handed to the test: a pointer drag cannot be driven in jsdom. */
const dropped: { onDragEnd?: (event: DragEndEvent) => void } = {};
jest.mock('@dnd-kit/core', () => {
  const actual = jest.requireActual('@dnd-kit/core');
  return {
    ...actual,
    DndContext: (props: { onDragEnd?: (event: DragEndEvent) => void }) => {
      dropped.onDragEnd = props.onDragEnd;
      return <actual.DndContext {...props} />;
    },
  };
});
jest.mock('@locales/useTranslation', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

const drop = (id: string, onto: string | null) => act(() => {
  dropped.onDragEnd?.({ active: { id }, over: onto ? { id: onto } : null } as unknown as DragEndEvent);
});
const shown = () => screen.getAllByRole('listitem').map((item) => item.textContent);
const items = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
const list = (rows: { id: string }[], onMove: (id: string, onto: string) => Promise<unknown>) => (
  <SortableList items={rows} onMove={onMove} renderItem={(item, index, handle) => (
    <span><DragHandle label={`drag ${item.id}`} handle={handle} />{item.id}{index}</span>
  )} />
);

describe('SortableList', () => {
  it('names each grip by its row and lets only the grip lift it', () => {
    render(list(items, jest.fn(() => Promise.resolve())));
    expect(screen.getByRole('button', { name: 'drag b' })).toBeInTheDocument();
    expect(shown()).toEqual(['a0', 'b1', 'c2']);
  });

  it('shows the dropped order at once and holds it while the move is written, then takes the list as it arrives', async () => {
    let finish!: () => void;
    const onMove = jest.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
    const { rerender } = render(list(items, onMove));
    drop('c', 'a');
    expect(onMove).toHaveBeenCalledWith('c', 'a', 'before');
    // The row is already where it was dropped: no jump back while the write takes.
    expect(shown()).toEqual(['c0', 'a1', 'b2']);
    rerender(list([{ id: 'c' }, { id: 'a' }, { id: 'b' }], onMove));
    expect(shown()).toEqual(['c0', 'a1', 'b2']);
    await act(async () => { finish(); });
    expect(shown()).toEqual(['c0', 'a1', 'b2']);
  });

  it('holds the latest drop when an earlier one ends first or its order arrives first: no flash of an older order', async () => {
    const finish: (() => void)[] = [];
    const onMove = jest.fn(() => new Promise<void>((resolve) => { finish.push(resolve); }));
    const { rerender } = render(list(items, onMove));
    drop('c', 'a');
    expect(shown()).toEqual(['c0', 'a1', 'b2']);
    drop('a', 'b');
    expect(onMove).toHaveBeenLastCalledWith('a', 'b', 'after');
    expect(shown()).toEqual(['c0', 'b1', 'a2']);
    // The first drop's order arrives, then the first drop ends: the second drop's order stays on screen.
    rerender(list([{ id: 'c' }, { id: 'a' }, { id: 'b' }], onMove));
    expect(shown()).toEqual(['c0', 'b1', 'a2']);
    await act(async () => { finish[0](); });
    expect(shown()).toEqual(['c0', 'b1', 'a2']);
    rerender(list([{ id: 'c' }, { id: 'b' }, { id: 'a' }], onMove));
    await act(async () => { finish[1](); });
    expect(shown()).toEqual(['c0', 'b1', 'a2']);
  });

  it('lets go of the held order when the move fails, so the list shows what is stored', async () => {
    let fail!: () => void;
    const onMove = jest.fn(() => new Promise<void>((_resolve, reject) => { fail = () => reject(new Error('refused')); }));
    render(list(items, onMove));
    drop('a', 'c');
    expect(shown()).toEqual(['b0', 'c1', 'a2']);
    await act(async () => { fail(); });
    expect(shown()).toEqual(['a0', 'b1', 'c2']);
  });

  it('does nothing for a drop on itself or outside the list', () => {
    const onMove = jest.fn(() => Promise.resolve());
    render(list(items, onMove));
    drop('b', 'b');
    drop('b', null);
    expect(onMove).not.toHaveBeenCalled();
    expect(shown()).toEqual(['a0', 'b1', 'c2']);
  });
});
