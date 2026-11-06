import { ScriptureLinks } from '@/components/bible/ScriptureLinks';
import { fireEvent } from '@testing-library/react';
import { render, screen } from '@testing-library/react';
import React from 'react';

import '@testing-library/jest-dom';
import Column from '@/components/Column';

// Mock dnd-kit to avoid drag and drop environment requirements
jest.mock('@dnd-kit/core', () => ({
  useDroppable: () => ({ setNodeRef: jest.fn(), isOver: false }),
}));

jest.mock('@dnd-kit/sortable', () => ({
  SortableContext: ({ children }: any) => <div>{children}</div>,
  verticalListSortingStrategy: jest.fn(),
}));

jest.mock('@hello-pangea/dnd', () => ({
  DragDropContext: ({ children }: any) => <div>{children}</div>,
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
}));

// Mock sonner to avoid side effects
jest.mock('sonner', () => ({ toast: { success: jest.fn(), error: jest.fn() } }));


describe('Column layout', () => {
  it('uses responsive widths without fixed min/max widths', () => {
    const { container } = render(
      <Column
        id="main"
        title="Main"
        items={[]}
        isFocusMode
        showFocusButton
        onToggleFocusMode={jest.fn()}
      />
    );

    // Outer wrapper should not include legacy max width
    const outer = container.firstElementChild as HTMLElement | null;
    expect(outer).toBeTruthy();
    if (outer) {
      expect(outer.className).not.toMatch(/max-w-\[1800px\]/);
    }

    // Inner scrollable area should include responsive min-widths and not fixed 1200px widths
    const responsiveInner = Array.from(container.querySelectorAll('div')).find((el) =>
      el.className.includes('md:min-w-[500px]')
    );
    expect(responsiveInner).toBeTruthy();
    if (responsiveInner) {
      expect(responsiveInner.className).toMatch(/w-full/);
      expect(responsiveInner.className).toMatch(/min-w-0/);
      expect(responsiveInner.className).toMatch(/md:min-w-\[500px\]/);
      expect(responsiveInner.className).toMatch(/lg:min-w-\[700px\]/);
      expect(responsiveInner.className).toMatch(/xl:min-w-\[900px\]/);
      expect(responsiveInner.className).toMatch(/pt-20/);
      expect(responsiveInner.className).toMatch(/md:p-6/);
      expect(responsiveInner.className).not.toMatch(/min-w-\[1200px\]/);
      expect(responsiveInner.className).not.toMatch(/max-w-\[1200px\]/);
    }
  });

  it('keeps normal-mode outline spacing inside draggable rows instead of sibling gaps', () => {
    render(
      <Column
        id="main"
        title="Main"
        items={[]}
        outlinePoints={[
          { id: 'point-1', text: 'Point 1', isReviewed: false },
          { id: 'point-2', text: 'Point 2', isReviewed: false },
        ]}
      />
    );

    const normalOutlineList = screen.getByTestId('droppable').firstElementChild as HTMLElement | null;
    expect(normalOutlineList).toBeTruthy();
    if (normalOutlineList) {
      expect(normalOutlineList.className).not.toMatch(/space-y-4/);
    }

    const draggableRoots = screen
      .getAllByTestId('draggable')
      .map((wrapper) => wrapper.firstElementChild as HTMLElement | null)
      .filter((element): element is HTMLElement => Boolean(element));

    expect(draggableRoots[0]?.className).toMatch(/\bpb-4\b/);
    expect(draggableRoots[1]?.className).toMatch(/\bpb-4\b/);
  });
});

it('orders displayed subpoints without mutating the parent-owned outline', () => {
  const subPoints = [
    { id: 'later', text: 'Later', position: 2 },
    { id: 'earlier', text: 'Earlier', position: 1 },
  ];
  Object.freeze(subPoints);
  const point = Object.freeze({ id: 'point', text: 'Point', isReviewed: false, subPoints });
  render(<Column id="main" title="Main" items={[]} outlinePoints={[point]} />);
  expect(subPoints.map(subPoint => subPoint.id)).toEqual(['later', 'earlier']);
  const earlier = screen.getByTestId('sub-point-drop-earlier');
  const later = screen.getByTestId('sub-point-drop-later');
  expect(earlier.compareDocumentPosition(later) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});

it('opens references in a displayed column point instead of editing its title', () => {
  const onOpen = jest.fn();
  render(<ScriptureLinks onOpen={onOpen}><Column id="main" title="Main" items={[]} outlinePoints={[{ id: 'ref-point', text: 'Read Ruth 1:2' }]} /></ScriptureLinks>);
  const links = screen.getAllByRole('button', { name: 'Ruth 1:2' });
  for (const link of links) fireEvent.click(link);
  expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ book: 'Ruth', chapter: 1, fromVerse: 2, label: 'Ruth 1:2' }));
  expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
});


describe('Column scripture foreground ownership', () => {
  const outlinePoints = [{ id: 'contrast-point', text: 'Read Ruth 1:2', subPoints: [
    { id: 'contrast-subpoint', text: 'Remember John 3:16', position: 1 },
  ] }];

  it.each([false, true])('keeps point and subpoint references in the colored foreground (focus=%s)', (focus) => {
    const onOpen = jest.fn();
    const { container } = render(<ScriptureLinks onOpen={onOpen}>
      <Column id="main" title="Main" items={[]} outlinePoints={outlinePoints} isFocusMode={focus} />
    </ScriptureLinks>);
    const colored = focus ? container.querySelector('div.sticky')
      : screen.getByRole('heading', { name: /^Main/, level: 2 }).closest('div.relative.mb-2');
    expect(colored).not.toBeNull();
    const links = colored!.querySelectorAll<HTMLButtonElement>('[data-scripture-link]');
    expect(links).toHaveLength(2);
    for (const link of links) {
      expect(link).toHaveClass('text-inherit', 'decoration-current', 'underline');
      expect(link).not.toHaveClass('text-indigo-700');
      expect(link).not.toHaveClass('dark:text-indigo-300');
      fireEvent.click(link);
      fireEvent.doubleClick(link);
    }
    expect(onOpen).toHaveBeenNthCalledWith(1, expect.objectContaining({ book: 'Ruth', chapter: 1, fromVerse: 2 }));
    expect(onOpen).toHaveBeenNthCalledWith(2, expect.objectContaining({ book: 'John', chapter: 3, fromVerse: 16 }));
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });

  it('keeps distinctive default links in the ordinary point card and nested list', () => {
    const { container } = render(<ScriptureLinks onOpen={jest.fn()}>
      <Column id="main" title="Main" items={[]} outlinePoints={outlinePoints} />
    </ScriptureLinks>);
    const pointLink = container.querySelector('h4 [data-scripture-link]');
    const subpointLink = container.querySelector('span[title="Remember John 3:16"] [data-scripture-link]');
    for (const link of [pointLink, subpointLink]) {
      expect(link).not.toBeNull();
      expect(link).toHaveClass('text-indigo-700', 'dark:text-indigo-300');
      expect(link).not.toHaveClass('text-inherit');
    }
  });
});
