import { render, screen } from '@testing-library/react';
import React from 'react';
import '@testing-library/jest-dom';

// Mocks for dnd libs used by Column/SermonPointPlaceholder
jest.mock('@dnd-kit/core', () => ({
  useDroppable: () => ({ setNodeRef: jest.fn(), isOver: false }),
}));

jest.mock('@dnd-kit/sortable', () => ({
  SortableContext: ({ children }: any) => <div>{children}</div>,
  verticalListSortingStrategy: jest.fn(),
  useSortable: () => ({
    attributes: {},
    listeners: {},
    setNodeRef: jest.fn(),
    transform: null,
    transition: null,
    isDragging: false,
  }),
}));

jest.mock('@hello-pangea/dnd', () => ({
  DragDropContext: ({ children }: any) => <>{children}</>,
  Droppable: ({ children }: any) => children({ droppableProps: {}, innerRef: jest.fn() }),
  Draggable: ({ children }: any) => children({ innerRef: jest.fn(), draggableProps: {}, dragHandleProps: {} }, { isDragging: false }),
}));

// Stub AudioRecorder – we only need to ensure the mic button is rendered
jest.mock('@/components/AudioRecorder', () => ({
  AudioRecorder: () => <div data-testid="audio-recorder-stub" />,
}));

import Column from '@/components/Column';

describe('Focus mode: mic icon per outline point', () => {
  it('renders a mic button in each outline point header', () => {
    const outlinePoints = [
      { id: 'op-1', text: 'Point A' },
      { id: 'op-2', text: 'Point B' },
    ];

    render(
      <Column
        id="main"
        title="Main"
        items={[{ id: 'i1', content: 'x', outlinePointId: 'op-1' }]}
        sermonId="s-1"
        isFocusMode={true}
        outlinePoints={outlinePoints}
        thoughtsPerSermonPoint={{}}
      />
    );

    // In focus mode the column-level recorder is rendered directly (no button),
    // so all buttons with this title belong to outline point headers.
    const micButtons = screen.getAllByTitle('audio.newRecording');
    expect(micButtons).toHaveLength(outlinePoints.length);
  });
});
