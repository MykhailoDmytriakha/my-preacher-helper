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
