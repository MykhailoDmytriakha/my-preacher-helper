import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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

jest.mock('@/components/FlatRecorderButton', () => ({
  FlatRecorderButton: (props: any) => (
    <button
      type="button"
      data-testid="flat-recorder-stub"
      data-disabled={String(Boolean(props.disabled))}
      onClick={() => props.onRecordingComplete?.(new Blob(['audio'], { type: 'audio/webm' }))}
    >
      Subpoint recorder
    </button>
  ),
}));

jest.mock('@/services/thought.service', () => ({
  createAudioThoughtWithForceTag: jest.fn(),
}));

import Column from '@/components/Column';
import { createAudioThoughtWithForceTag } from '@/services/thought.service';

const mockCreateAudioThoughtWithForceTag = createAudioThoughtWithForceTag as jest.MockedFunction<typeof createAudioThoughtWithForceTag>;

describe('Focus mode: mic icon per outline point', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

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

  it('renders a flat recorder in each sub-point lane and records into that sub-point', async () => {
    mockCreateAudioThoughtWithForceTag.mockResolvedValueOnce({
      id: 'thought-1',
      text: 'Subpoint thought',
      tags: ['main'],
      date: '2026-05-01T00:00:00.000Z',
      outlinePointId: 'op-1',
      subPointId: 'sp-1',
    } as any);

    const onAudioThoughtCreated = jest.fn();

    render(
      <Column
        id="main"
        title="Main"
        items={[]}
        sermonId="s-1"
        isFocusMode={true}
        onAudioThoughtCreated={onAudioThoughtCreated}
        outlinePoints={[
          {
            id: 'op-1',
            text: 'Point A',
            subPoints: [{ id: 'sp-1', text: 'Sub A', position: 1000 }],
          },
        ]}
        thoughtsPerSermonPoint={{}}
      />
    );

    fireEvent.click(screen.getByTestId('flat-recorder-stub'));

    await waitFor(() => {
      expect(mockCreateAudioThoughtWithForceTag).toHaveBeenCalledWith(
        expect.any(Blob),
        's-1',
        'main',
        0,
        3,
        'op-1',
        'sp-1'
      );
    });

    expect(onAudioThoughtCreated).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'thought-1', subPointId: 'sp-1' }),
      'main'
    );
  });
});
