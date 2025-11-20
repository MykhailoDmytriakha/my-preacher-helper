import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';

// Stub dnd-kit hooks/components used by Column
jest.mock('@dnd-kit/core', () => ({
  useDroppable: () => ({ setNodeRef: jest.fn(), isOver: false })
}));

jest.mock('@dnd-kit/sortable', () => ({
  SortableContext: ({ children }: any) => <>{children}</>,
  verticalListSortingStrategy: jest.fn()
}));

// Stub @hello-pangea/dnd (used only in focus mode which we don't test here)
jest.mock('@hello-pangea/dnd', () => ({
  DragDropContext: ({ children }: any) => <>{children}</>,
  Droppable: ({ children }: any) => children({ provided: { droppableProps: {}, innerRef: jest.fn() } }),
  Draggable: ({ children, draggableId, index }: any) => children({ providedDraggable: { draggableProps: {}, dragHandleProps: {}, innerRef: jest.fn() }, snapshot: { isDragging: false } })
}));

// Mock the AudioRecorder to a lightweight component we can assert on
jest.mock('@/components/AudioRecorder', () => ({
  AudioRecorder: (props: any) => (
    <div data-testid="audio-recorder-stub" data-autostart={String(!!props.autoStart)} />
  )
}));

// Import after mocks
import Column from '@/components/Column';

describe('Column mic popover and focus button', () => {
  const baseProps = {
    items: [],
    title: 'Main',
    onEdit: jest.fn(),
    outlinePoints: [],
    isFocusMode: false,
    thoughtsPerSermonPoint: {},
  };

  it('shows focus button for main and conclusion', () => {
    const { rerender } = render(
      <Column id="main" showFocusButton={true} onToggleFocusMode={jest.fn()} {...baseProps} />
    );
    // Title attribute is a translation key in tests
    expect(screen.getByTitle('structure.focusMode')).toBeInTheDocument();

    rerender(<Column id="conclusion" showFocusButton={true} onToggleFocusMode={jest.fn()} {...baseProps} />);
    expect(screen.getByTitle('structure.focusMode')).toBeInTheDocument();
  });

  it('renders mic button and opens popover with autoStart=true', () => {
    const onAudioThoughtCreated = jest.fn();
    render(
      <Column
        id="main"
        sermonId="sermon-1"
        showFocusButton={true}
        onAudioThoughtCreated={onAudioThoughtCreated}
        {...baseProps}
      />
    );

    const micBtn = screen.getByTitle('structure.recordAudio');
    expect(micBtn).toBeInTheDocument();

    fireEvent.click(micBtn);

    // Popover content (our stub) should be present
    const recorder = screen.getByTestId('audio-recorder-stub');
    expect(recorder).toBeInTheDocument();
    expect(recorder.getAttribute('data-autostart')).toBe('true');
  });
});
