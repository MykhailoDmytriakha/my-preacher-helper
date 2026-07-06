import { render, screen, waitFor, act, fireEvent, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';

import ScratchPanel from '@/components/sermon/ScratchPanel';

import type { ComposedPlanOutline } from '@/config/schemas/zod';
import type { ScratchNote, SermonOutline } from '@/models/models';

let mockScratchOnDragEnd: ((result: {
  draggableId: string;
  type: string;
  source: { droppableId: string; index: number };
  destination: { droppableId: string; index: number } | null;
}) => void) | undefined;
let scratchRecordingComplete: ((audioBlob: Blob) => void | Promise<void>) | undefined;
let scratchRetryVoice: (() => void) | undefined;

jest.mock('framer-motion', () => ({
  motion: {
    div: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) => <div {...props}>{children}</div>,
  },
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: { section?: string; count?: number }) => {
      const translations: Record<string, string> = {
        'scratch.capture.toBoard': 'Редактор плана',
        'scratch.capture.back': 'Наброски',
        'common.dragToReorder': 'Drag to reorder',
        'planEditor.note.label': 'Reminder note',
        'planEditor.note.delete': 'Delete plan note',
        'planEditor.note.add': 'note',
        'planEditor.note.placeholder': 'What I want to say here',
      };
      if (values?.section) return `${key}:${values.section}`;
      if (typeof values?.count === 'number') return `${key}:${values.count}`;
      return translations[key] ?? key;
    },
  }),
}));

jest.mock('@hello-pangea/dnd', () => {
  const React = jest.requireActual('react') as typeof import('react');

  return {
    DragDropContext: ({
      onDragEnd,
      children,
    }: {
      onDragEnd: NonNullable<typeof mockScratchOnDragEnd>;
      children: React.ReactNode;
    }) => {
      mockScratchOnDragEnd = onDragEnd;
      return <div data-testid="scratch-dnd-context">{children}</div>;
    },
    Droppable: ({
      droppableId,
      children,
    }: {
      droppableId: string;
      children: (
        provided: {
          innerRef: jest.Mock;
          droppableProps: Record<string, string>;
          placeholder: React.ReactNode;
        },
        snapshot: { isDraggingOver: boolean }
      ) => React.ReactNode;
    }) => (
      <div data-testid={`droppable-${droppableId}`}>
        {children(
          {
            innerRef: jest.fn(),
            droppableProps: { 'data-droppable-id': droppableId },
            placeholder: <div data-testid={`placeholder-${droppableId}`} />,
          },
          { isDraggingOver: false }
        )}
      </div>
    ),
    Draggable: ({
      draggableId,
      children,
    }: {
      draggableId: string;
      children: (
        provided: {
          innerRef: jest.Mock;
          draggableProps: { style: Record<string, never> };
          dragHandleProps: Record<string, string>;
        },
        snapshot: { isDragging: boolean }
      ) => React.ReactNode;
    }) => (
      <div data-testid={`draggable-${draggableId}`}>
        {children(
          {
            innerRef: jest.fn(),
            draggableProps: { style: {} },
            dragHandleProps: { 'data-testid': `drag-handle-${draggableId}` },
          },
          { isDragging: false }
        )}
      </div>
    ),
  };
});

jest.mock('sonner', () => ({
  toast: {
    error: jest.fn(),
    message: jest.fn(),
    success: jest.fn(),
  },
}));

const toastMock = () =>
  (jest.requireMock('sonner') as {
    toast: {
      error: jest.Mock;
      message: jest.Mock;
      success: jest.Mock;
    };
  }).toast;

jest.mock('react-dom', () => ({
  ...jest.requireActual('react-dom'),
  createPortal: (node: unknown) => node,
}));

jest.mock('@/providers/ConnectionProvider', () => ({
  useConnection: () => ({ isMagicAvailable: true, isOnline: true }),
}));

jest.mock('@/components/AudioRecorder', () => ({
  AudioRecorder: () => <div data-testid="scratch-voice-recorder" />,
}));

jest.mock('@/components/sermon/AudioRecorderPortalBridge', () => ({
  __esModule: true,
  default: ({
    onRecordingComplete,
    onRetry,
    retryCount,
    maxRetries,
    transcriptionError,
    manualControl,
    manualButtonPlacement,
    isReadOnly,
    isRecorderDisabled,
  }: {
    onRecordingComplete: (audioBlob: Blob) => void;
    onRetry: () => void;
    retryCount: number;
    maxRetries?: number;
    transcriptionError?: string | null;
    manualControl?: React.ReactNode;
    manualButtonPlacement?: string;
    isReadOnly?: boolean;
    isRecorderDisabled?: boolean;
  }) => {
    scratchRecordingComplete = onRecordingComplete;
    scratchRetryVoice = onRetry;

    return (
      <div data-testid="scratch-capture-bridge" data-placement={manualButtonPlacement}>
        {manualControl}
        <button
          type="button"
          disabled={isReadOnly || isRecorderDisabled}
          onClick={() => onRecordingComplete(new Blob(['voice']))}
        >
          audio.newRecording
        </button>
        {transcriptionError ? (
          <div role="alert">
            <span>{transcriptionError}</span>
            <button
              type="button"
              aria-label="audio.retryTranscription"
              onClick={() => onRetry()}
            >
              audio.retryTranscription ({retryCount + 1}/{maxRetries ?? 3})
            </button>
          </div>
        ) : null}
      </div>
    );
  },
}));

jest.mock('@/components/ui/ConfirmModal', () => ({
  __esModule: true,
  default: ({
    isOpen,
    onConfirm,
    confirmText,
    confirmDisabled,
    children,
  }: {
    isOpen: boolean;
    onConfirm: () => void;
    confirmText: string;
    confirmDisabled?: boolean;
    children?: React.ReactNode;
  }) =>
    isOpen ? (
      <div role="dialog">
        <button type="button" onClick={onConfirm} disabled={confirmDisabled}>
          {confirmText}
        </button>
        {children}
      </div>
  ) : null,
}));

jest.mock('@/components/ui/RichMarkdownEditor', () => ({
  RichMarkdownEditor: ({
    value,
    onChange,
    placeholder,
  }: {
    value: string;
    onChange: (value: string) => void;
    placeholder?: string;
  }) => (
    <textarea
      aria-label={placeholder}
      placeholder={placeholder}
      value={value}
      onChange={(event) => onChange(event.target.value)}
    />
  ),
}));

jest.mock('@/hooks/useScrollLock', () => ({
  useScrollLock: jest.fn(),
}));

jest.mock('@/services/scratch.service', () => ({
  composePlanFromScratch: jest.fn(),
}));

jest.mock('@/services/thought.service', () => ({
  transcribeThoughtAudio: jest.fn(),
}));

jest.mock('@/utils/clientId', () => ({
  newClientId: jest.fn(),
}));

const composePlanFromScratchMock = () =>
  (jest.requireMock('@/services/scratch.service') as { composePlanFromScratch: jest.Mock }).composePlanFromScratch;
const transcribeThoughtAudioMock = () =>
  (jest.requireMock('@/services/thought.service') as { transcribeThoughtAudio: jest.Mock }).transcribeThoughtAudio;
const newClientIdMock = () =>
  (jest.requireMock('@/utils/clientId') as { newClientId: jest.Mock }).newClientId;

const emptyOutline: SermonOutline = {
  introduction: [],
  main: [],
  conclusion: [],
};

const baseNotes: ScratchNote[] = [
  { id: 'n1', text: 'First scratch note', createdAt: '2026-07-04T00:00:00.000Z' },
  { id: 'n2', text: 'Second scratch note', createdAt: '2026-07-04T00:01:00.000Z', section: 'introduction' },
];

const composeOutline = (outline: Partial<ComposedPlanOutline>): ComposedPlanOutline => ({
  introduction: outline.introduction ?? [],
  main: outline.main ?? [],
  conclusion: outline.conclusion ?? [],
});

function renderScratchPanel(overrides: Partial<React.ComponentProps<typeof ScratchPanel>> = {}) {
  const props: React.ComponentProps<typeof ScratchPanel> = {
    sermonId: 'sermon-1',
    notes: baseNotes,
    outline: emptyOutline,
    addScratchNote: jest.fn(),
    restoreScratchNote: jest.fn(),
    updateScratchNote: jest.fn(),
    deleteScratchNote: jest.fn(),
    setScratchNoteSection: jest.fn(),
    isScratchWritePending: false,
    scratchRevision: 0,
    onApplyOutline: jest.fn().mockResolvedValue(undefined),
    onOutlineChange: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };

  return {
    props,
    user: userEvent.setup(),
    ...render(<ScratchPanel {...props} />),
  };
}

async function openBoard(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'Редактор плана' }));
}

function expectPlanEditorNoteVisual(container: HTMLElement, text: string) {
  const noteText = within(container).getByText(text);
  const noteRoot = noteText.closest('div');
  if (!noteRoot) throw new Error(`Missing note root for ${text}`);
  expect(noteRoot).toHaveClass('text-xs', 'italic', 'text-slate-500', 'dark:text-gray-400');
  const icons = Array.from(noteRoot.querySelectorAll('svg'));
  expect(
    icons.some((icon) =>
      icon.getAttribute('class')?.includes('text-amber-500/80')
    )
  ).toBe(true);
}

describe('ScratchPanel', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useRealTimers();
    Object.defineProperty(navigator, 'onLine', {
      configurable: true,
      value: true,
    });
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: jest.fn(() => 'blob:scratch-voice-recovery'),
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      value: jest.fn(),
    });
    mockScratchOnDragEnd = undefined;
    scratchRecordingComplete = undefined;
    scratchRetryVoice = undefined;
    let idCounter = 0;
    newClientIdMock().mockImplementation(() => `fresh-id-${++idCounter}`);
  });

  it('opens a labeled manual capture form, keeps it open after Enter, and leaves voice capture available', async () => {
    transcribeThoughtAudioMock().mockResolvedValueOnce({ polishedText: 'Voice scratch note' });
    const addScratchNote = jest.fn((text: string) => ({ id: `new-${text}`, text, createdAt: 'now' }));
    const { user } = renderScratchPanel({ notes: [], addScratchNote });

    expect(screen.getByTestId('scratch-capture-bridge')).toHaveAttribute('data-placement', 'right');
    expect(screen.queryByRole('textbox', { name: 'scratch.capture.manualLabel' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'audio.newRecording' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'scratch.capture.manualAdd' }));
    const input = screen.getByRole('textbox', { name: 'scratch.capture.manualLabel' });
    expect(screen.getByRole('button', { name: 'scratch.capture.add' })).toBeVisible();
    await user.type(input, 'Manual scratch note{enter}');

    expect(addScratchNote).toHaveBeenCalledWith('Manual scratch note');
    expect(screen.getByRole('textbox', { name: 'scratch.capture.manualLabel' })).toHaveValue('');

    await user.type(screen.getByRole('textbox', { name: 'scratch.capture.manualLabel' }), 'Second scratch note{enter}');
    expect(addScratchNote).toHaveBeenCalledWith('Second scratch note');
    expect(screen.getByRole('textbox', { name: 'scratch.capture.manualLabel' })).toBeInTheDocument();

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('textbox', { name: 'scratch.capture.manualLabel' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'audio.newRecording' }));
    await waitFor(() => expect(addScratchNote).toHaveBeenCalledWith('Voice scratch note'));
    expect(transcribeThoughtAudioMock()).toHaveBeenCalledTimes(1);
  });

  it('renders scratch note cards with the plan-editor PointNote visual treatment', () => {
    renderScratchPanel();

    const card = screen.getByTestId('scratch-note-card-n1');
    expectPlanEditorNoteVisual(card, 'First scratch note');
  });

  it('renders capture controls and scratch note cards as read-only under the capture lock', async () => {
    const addScratchNote = jest.fn();
    const updateScratchNote = jest.fn();
    const deleteScratchNote = jest.fn();
    const { user } = renderScratchPanel({
      addScratchNote,
      updateScratchNote,
      deleteScratchNote,
      isReadOnly: true,
    });

    expect(screen.getByRole('button', { name: 'scratch.capture.manualAdd' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'audio.newRecording' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'scratch.card.delete' })).not.toBeInTheDocument();

    await user.click(screen.getByText('First scratch note'));
    expect(screen.queryByRole('textbox', { name: 'planEditor.note.placeholder' })).not.toBeInTheDocument();
    expect(addScratchNote).not.toHaveBeenCalled();
    expect(updateScratchNote).not.toHaveBeenCalled();
    expect(deleteScratchNote).not.toHaveBeenCalled();
  });

  it('does not drop an in-flight voice transcription if the capture lock flips before completion', async () => {
    let resolveTranscription: (value: { polishedText: string }) => void = () => undefined;
    transcribeThoughtAudioMock().mockReturnValueOnce(
      new Promise<{ polishedText: string }>((resolve) => {
        resolveTranscription = resolve;
      })
    );
    const addScratchNote = jest.fn((text: string) => ({ id: `new-${text}`, text, createdAt: 'now' }));
    const { user, props, rerender } = renderScratchPanel({ notes: [], addScratchNote });

    await user.click(screen.getByRole('button', { name: 'audio.newRecording' }));
    await waitFor(() => expect(transcribeThoughtAudioMock()).toHaveBeenCalledTimes(1));

    rerender(<ScratchPanel {...props} isReadOnly />);

    await act(async () => {
      resolveTranscription({ polishedText: 'Voice note that must survive' });
    });

    await waitFor(() => expect(addScratchNote).toHaveBeenCalledWith('Voice note that must survive'));
  });

  it('renders existing sermon outline in board columns with point and sub-point drop zones', async () => {
    const existingOutline: SermonOutline = {
      introduction: [{ id: 'existing-intro', text: 'Existing intro point' }],
      main: [
        {
          id: 'existing-main',
          text: 'Existing main point',
          subPoints: [{ id: 'existing-sub', text: 'Existing sub-point', position: 1000 }],
        },
      ],
      conclusion: [],
    };
    const { user } = renderScratchPanel({ outline: existingOutline });
    const planEditorButton = screen.getByRole('button', { name: 'Редактор плана' });

    expect(planEditorButton).toHaveClass('bg-gradient-to-r', 'from-violet-600', 'to-fuchsia-600');
    expect(planEditorButton).not.toHaveClass('bg-amber-600');
    await user.click(planEditorButton);

    expect(screen.getByTestId('scratch-note-pool-band')).toBeInTheDocument();
    expect(within(screen.getByTestId('scratch-note-pool-band')).getByText('First scratch note')).toBeInTheDocument();
    expect(within(screen.getByTestId('scratch-note-pool-band')).getByText('Second scratch note')).toBeInTheDocument();
    expect(screen.getByText('Existing intro point')).toBeInTheDocument();
    expect(screen.getByText('Existing main point')).toBeInTheDocument();
    expect(screen.getByText('Existing sub-point')).toBeInTheDocument();
    expect(screen.getByTestId('scratch-point-drop-zone-existing-main')).toHaveTextContent('scratch.board.dropHerePoint');
    expect(screen.getByTestId('scratch-subpoint-drop-zone-existing-sub')).toHaveTextContent(
      'scratch.board.dropHereSubPoint'
    );
    expect(screen.getByTestId('outline-board-column-introduction')).toBeInTheDocument();
    expect(screen.getByTestId('outline-board-column-main')).toBeInTheDocument();
    expect(screen.getByTestId('outline-board-column-conclusion')).toBeInTheDocument();
    expect(screen.getByTestId('droppable-introduction')).toBeInTheDocument();
    expect(screen.getByTestId('droppable-main')).toBeInTheDocument();
    expect(screen.getByTestId('droppable-conclusion')).toBeInTheDocument();
    expect(screen.getByTestId('scratch-dnd-context')).toBeInTheDocument();
    expect(screen.getByTestId('drag-handle-n1')).toHaveAttribute('aria-label', 'Drag to reorder');
    expect(screen.getAllByText('structure.addPointButton')).toHaveLength(3);
    expect(screen.getAllByText('structure.addSubPoint')).toHaveLength(2);
    expect(screen.getByRole('button', { name: 'Наброски' })).toHaveClass('border-amber-300');
  });

  it('persists manual outline edits through the silent outline-change handler', async () => {
    const onOutlineChange = jest.fn().mockResolvedValue(undefined);
    const onApplyOutline = jest.fn().mockResolvedValue(undefined);
    const { user } = renderScratchPanel({ onOutlineChange, onApplyOutline });

    await openBoard(user);
    const introCol = screen.getByTestId('outline-board-column-introduction');
    await user.click(within(introCol).getByText('structure.addPointButton'));
    const input = within(introCol).getByPlaceholderText('structure.addPointPlaceholder');
    await user.type(input, 'manual point{enter}');

    await waitFor(() => expect(onOutlineChange).toHaveBeenCalledTimes(1));
    expect(onOutlineChange.mock.calls[0][0].introduction[0].text).toBe('Manual point');
    expect(onApplyOutline).not.toHaveBeenCalled();
  });

  it('keeps the latest manual outline draft visible when an older outline prop arrives', async () => {
    const initialOutline: SermonOutline = {
      introduction: [{ id: 'p1', text: 'Initial point' }],
      main: [],
      conclusion: [],
    };
    const onOutlineChange = jest.fn(() => new Promise<void>(() => undefined));
    const { user, props, rerender } = renderScratchPanel({ outline: initialOutline, onOutlineChange });

    await openBoard(user);
    const introCol = screen.getByTestId('outline-board-column-introduction');
    await user.click(within(introCol).getByLabelText('common.edit'));
    fireEvent.change(within(introCol).getByDisplayValue('Initial point'), {
      target: { value: 'first edit' },
    });
    await user.click(within(introCol).getByLabelText('common.save'));
    await waitFor(() => expect(onOutlineChange).toHaveBeenCalledTimes(1));

    await user.click(within(introCol).getByLabelText('common.edit'));
    fireEvent.change(within(introCol).getByDisplayValue('First edit'), {
      target: { value: 'second edit' },
    });
    await user.click(within(introCol).getByLabelText('common.save'));
    await waitFor(() => expect(onOutlineChange).toHaveBeenCalledTimes(2));

    const [[olderAckOutline]] = onOutlineChange.mock.calls as unknown as [SermonOutline][];
    rerender(<ScratchPanel {...props} outline={olderAckOutline} />);

    expect(screen.getByText('Second edit')).toBeInTheDocument();
    expect(screen.queryByText('First edit')).not.toBeInTheDocument();
  });

  it('places notes on point and sub-point drop zones, supports pool round-trip, and applies notes additively', async () => {
    const existingOutline: SermonOutline = {
      introduction: [],
      main: [
        {
          id: 'existing-main',
          text: 'Existing main point',
          note: 'Existing point note',
          subPoints: [{ id: 'existing-sub', text: 'Existing sub-point', position: 1000, note: 'Existing sub note' }],
        },
      ],
      conclusion: [],
    };
    const onApplyOutline = jest.fn().mockResolvedValue(undefined);
    const deleteScratchNote = jest.fn();
    const setScratchNoteSection = jest.fn();
    const { user, props } = renderScratchPanel({
      outline: existingOutline,
      onApplyOutline,
      deleteScratchNote,
      setScratchNoteSection,
    });

    await openBoard(user);
    const applyButton = screen.getByRole('button', { name: 'scratch.board.apply' });
    expect(applyButton).toBeDisabled();

    expect(mockScratchOnDragEnd).toBeDefined();
    act(() => {
      mockScratchOnDragEnd?.({
        draggableId: 'n1',
        type: 'scratch-note',
        source: { droppableId: 'scratch-note-pool', index: 0 },
        destination: null,
      });
    });
    expect(within(screen.getByTestId('scratch-note-pool-band')).getByText('First scratch note')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'scratch.board.apply' })).toBeDisabled();

    act(() => {
      mockScratchOnDragEnd?.({
        draggableId: 'n1',
        type: 'scratch-note',
        source: { droppableId: 'scratch-note-pool', index: 0 },
        destination: { droppableId: 'scratch-point:existing-main', index: 0 },
      });
    });
    expect(within(screen.getByTestId('scratch-note-pool-band')).queryByText('First scratch note')).not.toBeInTheDocument();
    expect(within(screen.getByTestId('scratch-point-drop-zone-existing-main')).getByText('First scratch note')).toBeInTheDocument();
    expect(screen.getByTestId('scratch-placed-note-n1')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'scratch.board.apply' })).toBeEnabled();

    act(() => {
      mockScratchOnDragEnd?.({
        draggableId: 'n1',
        type: 'scratch-note',
        source: { droppableId: 'scratch-point:existing-main', index: 0 },
        destination: { droppableId: 'scratch-note-pool', index: 0 },
      });
    });
    expect(within(screen.getByTestId('scratch-note-pool-band')).getByText('First scratch note')).toBeInTheDocument();
    expect(within(screen.getByTestId('scratch-point-drop-zone-existing-main')).queryByText('First scratch note')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'scratch.board.apply' })).toBeDisabled();

    act(() => {
      mockScratchOnDragEnd?.({
        draggableId: 'n1',
        type: 'scratch-note',
        source: { droppableId: 'scratch-note-pool', index: 0 },
        destination: { droppableId: 'scratch-subpoint:existing-sub', index: 0 },
      });
      mockScratchOnDragEnd?.({
        draggableId: 'n2',
        type: 'scratch-note',
        source: { droppableId: 'scratch-note-pool', index: 1 },
        destination: { droppableId: 'scratch-point:existing-main', index: 0 },
      });
    });

    expect(within(screen.getByTestId('scratch-subpoint-drop-zone-existing-sub')).getByText('First scratch note')).toBeInTheDocument();
    expect(within(screen.getByTestId('scratch-point-drop-zone-existing-main')).getByText('Second scratch note')).toBeInTheDocument();
    expect(props.setScratchNoteSection).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'scratch.board.apply' }));

    await waitFor(() => expect(onApplyOutline).toHaveBeenCalledTimes(1));
    expect(onApplyOutline.mock.calls[0][0]).toEqual({
      introduction: [],
      main: [
        {
          id: 'existing-main',
          text: 'Existing main point',
          note: 'Existing point note\nSecond scratch note',
          subPoints: [
            {
              id: 'existing-sub',
              text: 'Existing sub-point',
              position: 1000,
              note: 'Existing sub note\nFirst scratch note',
            },
          ],
        },
      ],
      conclusion: [],
    });
    expect(new Set(onApplyOutline.mock.calls[0][1])).toEqual(new Set(['n1', 'n2']));
    expect(deleteScratchNote).not.toHaveBeenCalled();
  });

  it('disables Apply and ignores its click handler while a voice transcription is processing', async () => {
    let resolveTranscription: (value: { polishedText: string }) => void = () => undefined;
    transcribeThoughtAudioMock().mockReturnValueOnce(
      new Promise<{ polishedText: string }>((resolve) => {
        resolveTranscription = resolve;
      })
    );
    const existingOutline: SermonOutline = {
      introduction: [],
      main: [{ id: 'existing-main', text: 'Existing main point' }],
      conclusion: [],
    };
    const addScratchNote = jest.fn((text: string) => ({ id: `new-${text}`, text, createdAt: 'now' }));
    const onApplyOutline = jest.fn().mockResolvedValue(undefined);
    const { user } = renderScratchPanel({ outline: existingOutline, addScratchNote, onApplyOutline });

    await user.click(screen.getByRole('button', { name: 'audio.newRecording' }));
    await waitFor(() => expect(transcribeThoughtAudioMock()).toHaveBeenCalledTimes(1));
    await openBoard(user);

    act(() => {
      mockScratchOnDragEnd?.({
        draggableId: 'n1',
        type: 'scratch-note',
        source: { droppableId: 'scratch-note-pool', index: 0 },
        destination: { droppableId: 'scratch-point:existing-main', index: 0 },
      });
    });

    const applyButton = screen.getByRole('button', { name: 'scratch.board.apply' });
    expect(applyButton).toBeDisabled();
    expect(applyButton.closest('span')).toHaveAttribute('title', 'scratch.board.applyVoiceProcessing');

    applyButton.removeAttribute('disabled');
    fireEvent.click(applyButton);
    expect(onApplyOutline).not.toHaveBeenCalled();

    await act(async () => {
      resolveTranscription({ polishedText: 'Voice note after guarded apply' });
    });

    await waitFor(() => expect(addScratchNote).toHaveBeenCalledWith('Voice note after guarded apply'));
  });

  it('does not hang Apply while offline when the Firestore apply promise never settles', async () => {
    Object.defineProperty(navigator, 'onLine', {
      configurable: true,
      value: false,
    });
    const existingOutline: SermonOutline = {
      introduction: [],
      main: [{ id: 'existing-main', text: 'Existing main point' }],
      conclusion: [],
    };
    const onApplyOutline = jest.fn(() => new Promise<void>(() => undefined));
    const { user } = renderScratchPanel({ outline: existingOutline, onApplyOutline });

    await openBoard(user);
    act(() => {
      mockScratchOnDragEnd?.({
        draggableId: 'n1',
        type: 'scratch-note',
        source: { droppableId: 'scratch-note-pool', index: 0 },
        destination: { droppableId: 'scratch-point:existing-main', index: 0 },
      });
    });

    await user.click(screen.getByRole('button', { name: 'scratch.board.apply' }));

    await waitFor(() => expect(onApplyOutline).toHaveBeenCalledTimes(1));
    const [[appliedOutline, consumedNoteIds]] = onApplyOutline.mock.calls as unknown as [
      SermonOutline,
      string[],
    ][];
    expect(appliedOutline.main[0].note).toBe('First scratch note');
    expect(consumedNoteIds).toEqual(['n1']);
    await waitFor(() => expect(screen.getByRole('button', { name: 'scratch.board.apply' })).toBeDisabled());
    expect(screen.queryByRole('button', { name: 'common.saving' })).not.toBeInTheDocument();
  });

  it('locks board edits, note placement, and compose while Apply is in flight', async () => {
    const existingOutline: SermonOutline = {
      introduction: [],
      main: [{ id: 'existing-main', text: 'Existing main point' }],
      conclusion: [],
    };
    let resolveApply: () => void = () => undefined;
    const applyPromise = new Promise<void>((resolve) => {
      resolveApply = resolve;
    });
    const onApplyOutline = jest.fn(() => applyPromise);
    const onOutlineChange = jest.fn().mockResolvedValue(undefined);
    const { user } = renderScratchPanel({ outline: existingOutline, onApplyOutline, onOutlineChange });

    await openBoard(user);
    act(() => {
      mockScratchOnDragEnd?.({
        draggableId: 'n1',
        type: 'scratch-note',
        source: { droppableId: 'scratch-note-pool', index: 0 },
        destination: { droppableId: 'scratch-point:existing-main', index: 0 },
      });
    });
    await user.click(screen.getByRole('button', { name: 'scratch.board.apply' }));

    await waitFor(() => expect(screen.getByRole('button', { name: 'common.saving' })).toBeDisabled());
    const backButton = screen.getByRole('button', { name: 'Наброски' });
    expect(backButton).toBeDisabled();
    expect(screen.queryByText('structure.addPointButton')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'scratch.board.compose' })).toBeDisabled();
    await user.click(backButton);
    expect(screen.queryByRole('button', { name: 'audio.newRecording' })).not.toBeInTheDocument();

    act(() => {
      mockScratchOnDragEnd?.({
        draggableId: 'n2',
        type: 'scratch-note',
        source: { droppableId: 'scratch-note-pool', index: 0 },
        destination: { droppableId: 'scratch-point:existing-main', index: 0 },
      });
    });
    expect(within(screen.getByTestId('scratch-point-drop-zone-existing-main')).queryByText('Second scratch note')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'scratch.board.compose' }));
    expect(composePlanFromScratchMock()).not.toHaveBeenCalled();
    expect(onOutlineChange).not.toHaveBeenCalled();

    await act(async () => {
      resolveApply();
      await applyPromise;
    });
  });

  it('retains a completed voice blob during Apply and retries it after Apply clears', async () => {
    const existingOutline: SermonOutline = {
      introduction: [],
      main: [{ id: 'existing-main', text: 'Existing main point' }],
      conclusion: [],
    };
    let resolveApply: () => void = () => undefined;
    const applyPromise = new Promise<void>((resolve) => {
      resolveApply = resolve;
    });
    const onApplyOutline = jest.fn(() => applyPromise);
    const addScratchNote = jest.fn((text: string) => ({ id: `new-${text}`, text, createdAt: 'now' }));
    transcribeThoughtAudioMock().mockResolvedValueOnce({ polishedText: 'Voice thought after apply' });
    const { user } = renderScratchPanel({ outline: existingOutline, onApplyOutline, addScratchNote });
    const completeRecording = scratchRecordingComplete;

    expect(completeRecording).toBeDefined();
    await openBoard(user);
    act(() => {
      mockScratchOnDragEnd?.({
        draggableId: 'n1',
        type: 'scratch-note',
        source: { droppableId: 'scratch-note-pool', index: 0 },
        destination: { droppableId: 'scratch-point:existing-main', index: 0 },
      });
    });
    await user.click(screen.getByRole('button', { name: 'scratch.board.apply' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'common.saving' })).toBeDisabled());

    await act(async () => {
      await completeRecording?.(new Blob(['voice-during-apply']));
    });

    expect(transcribeThoughtAudioMock()).not.toHaveBeenCalled();
    expect(addScratchNote).not.toHaveBeenCalled();

    await act(async () => {
      resolveApply();
      await applyPromise;
    });
    await waitFor(() => expect(screen.queryByRole('button', { name: 'common.saving' })).not.toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: 'Наброски' }));
    expect(screen.getByText('audio.savedRecording')).toBeInTheDocument();
    expect(screen.getByText('scratch.voice.applyInProgress')).toBeInTheDocument();
    expect(screen.getByLabelText('audio.playRecording')).toHaveAttribute('src', 'blob:scratch-voice-recovery');

    await user.click(screen.getByRole('button', { name: 'audio.retryTranscription' }));

    await waitFor(() => expect(transcribeThoughtAudioMock()).toHaveBeenCalledTimes(1));
    expect(transcribeThoughtAudioMock()).toHaveBeenCalledWith(expect.any(Blob));
    await waitFor(() => expect(addScratchNote).toHaveBeenCalledWith('Voice thought after apply'));
    expect(scratchRetryVoice).toBeDefined();
  });

  it('sends only pooled scratch notes to compose when another note is manually placed', async () => {
    const existingOutline: SermonOutline = {
      introduction: [],
      main: [{ id: 'existing-main', text: 'Existing main point' }],
      conclusion: [],
    };
    composePlanFromScratchMock().mockResolvedValueOnce(
      composeOutline({
        main: [
          {
            id: 'composed-from-pooled',
            scratchNoteId: 'n2',
            text: 'Composed from pooled note',
            source: 'ai',
          },
        ],
      })
    );
    const { user } = renderScratchPanel({ outline: existingOutline });

    await openBoard(user);
    act(() => {
      mockScratchOnDragEnd?.({
        draggableId: 'n1',
        type: 'scratch-note',
        source: { droppableId: 'scratch-note-pool', index: 0 },
        destination: { droppableId: 'scratch-point:existing-main', index: 0 },
      });
    });

    await user.click(screen.getByRole('button', { name: 'scratch.board.compose' }));

    await waitFor(() => expect(composePlanFromScratchMock()).toHaveBeenCalledTimes(1));
    expect(composePlanFromScratchMock()).toHaveBeenCalledWith('sermon-1', existingOutline, ['n2']);
    expect(await screen.findByText('Composed from pooled note')).toBeInTheDocument();
  });

  it('keeps edits to an AI proposal local until Apply and consumes the composed source note', async () => {
    const onOutlineChange = jest.fn().mockResolvedValue(undefined);
    const onApplyOutline = jest.fn().mockResolvedValue(undefined);
    composePlanFromScratchMock().mockResolvedValueOnce(
      composeOutline({
        main: [
          {
            id: 'ai-point',
            scratchNoteId: 'n1',
            text: 'AI proposed point',
            source: 'ai',
          },
        ],
      })
    );
    const { user } = renderScratchPanel({ onOutlineChange, onApplyOutline });

    await openBoard(user);
    await user.click(screen.getByRole('button', { name: 'scratch.board.compose' }));
    expect(await screen.findByText('AI proposed point')).toBeInTheDocument();

    const mainCol = screen.getByTestId('outline-board-column-main');
    await user.click(within(mainCol).getByLabelText('common.edit'));
    const input = within(mainCol).getByDisplayValue('AI proposed point');
    fireEvent.change(input, { target: { value: 'edited proposal point' } });
    await user.click(within(mainCol).getByLabelText('common.save'));

    expect(onOutlineChange).not.toHaveBeenCalled();
    expect(onApplyOutline).not.toHaveBeenCalled();
    expect(screen.getByText('Edited proposal point')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'scratch.board.apply' }));

    await waitFor(() => expect(onApplyOutline).toHaveBeenCalledTimes(1));
    expect(onApplyOutline.mock.calls[0][0].main[0]).toMatchObject({
      id: 'fresh-id-2',
      text: 'Edited proposal point',
    });
    expect(onApplyOutline.mock.calls[0][1]).toEqual(['n1']);
  });

  it('remaps a manual placement onto an AI-composed point before Apply strips scratch ids', async () => {
    const onApplyOutline = jest.fn().mockResolvedValue(undefined);
    composePlanFromScratchMock().mockResolvedValueOnce(
      composeOutline({
        main: [
          {
            id: 'ai-point',
            scratchNoteId: 'n1',
            text: 'AI proposed point',
            source: 'ai',
          },
        ],
      })
    );
    const { user } = renderScratchPanel({ onApplyOutline });

    await openBoard(user);
    await user.click(screen.getByRole('button', { name: 'scratch.board.compose' }));
    expect(await screen.findByText('AI proposed point')).toBeInTheDocument();

    act(() => {
      mockScratchOnDragEnd?.({
        draggableId: 'n2',
        type: 'scratch-note',
        source: { droppableId: 'scratch-note-pool', index: 0 },
        destination: { droppableId: 'scratch-point:ai-point', index: 0 },
      });
    });
    expect(within(screen.getByTestId('scratch-point-drop-zone-ai-point')).getByText('Second scratch note')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'scratch.board.apply' }));

    await waitFor(() => expect(onApplyOutline).toHaveBeenCalledTimes(1));
    expect(onApplyOutline.mock.calls[0][0]).toEqual({
      introduction: [],
      main: [
        {
          id: 'fresh-id-1',
          text: 'AI proposed point',
          note: 'Second scratch note',
        },
      ],
      conclusion: [],
    });
    expect(new Set(onApplyOutline.mock.calls[0][1])).toEqual(new Set(['n1', 'n2']));
  });

  it('renders composed plans inside the full OutlineBoard editor', async () => {
    composePlanFromScratchMock().mockResolvedValueOnce(
      composeOutline({
        introduction: [
          {
            id: 'p-manual',
            scratchNoteId: 'n2',
            text: 'Manual intro point',
            note: 'Pinned by preacher',
            source: 'manual',
          },
        ],
      })
    );
    const { user } = renderScratchPanel();

    await openBoard(user);
    await user.click(screen.getByRole('button', { name: 'scratch.board.compose' }));

    expect(composePlanFromScratchMock()).toHaveBeenCalledWith('sermon-1', emptyOutline, ['n1', 'n2']);
    expect(await screen.findByText('Manual intro point')).toBeInTheDocument();
    expectPlanEditorNoteVisual(document.body, 'Pinned by preacher');
    expect(screen.queryByText('scratch.board.aiBadge')).not.toBeInTheDocument();
    expect(screen.queryByText('scratch.board.manualBadge')).not.toBeInTheDocument();
    expect(screen.getByTestId('outline-board-column-introduction')).toBeInTheDocument();
    expect(screen.getAllByText('structure.addPointButton')).toHaveLength(3);
    expect(screen.getByText('scratch.board.composeSuccessAllManual')).toBeInTheDocument();
  });

  it('applies the merged outline additively, preserving existing ids and stripping scratch metadata', async () => {
    const onApplyOutline = jest.fn().mockResolvedValue(undefined);
    const existingOutline: SermonOutline = {
      introduction: [],
      main: [
        {
          id: 'existing-main',
          text: 'Existing main point',
          note: 'Existing note',
          isReviewed: true,
          subPoints: [{ id: 'existing-sub', text: 'Existing sub-point', position: 1000, note: 'Keep sub note' }],
        },
      ],
      conclusion: [],
    };
    composePlanFromScratchMock().mockResolvedValueOnce(
      composeOutline({
        main: [
          {
            ...existingOutline.main[0],
            subPoints: [
              ...(existingOutline.main[0].subPoints ?? []),
              {
                id: 'server-ai-sub',
                scratchNoteId: 'n1',
                text: 'AI sub-point',
                note: 'Keep this note',
                position: 2000,
                source: 'ai',
              },
            ],
          },
        ],
      })
    );
    const { user } = renderScratchPanel({ outline: existingOutline, onApplyOutline });

    await openBoard(user);
    expect(screen.getByText('Existing main point')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'scratch.board.compose' }));
    expect(await screen.findByText('AI sub-point')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'scratch.board.apply' }));

    await waitFor(() => expect(onApplyOutline).toHaveBeenCalledTimes(1));
    expect(onApplyOutline.mock.calls[0][0]).toEqual({
      introduction: [],
      main: [
        {
          id: 'existing-main',
          text: 'Existing main point',
          note: 'Existing note',
          isReviewed: true,
          subPoints: [
            { id: 'existing-sub', text: 'Existing sub-point', position: 1000, note: 'Keep sub note' },
            { id: 'fresh-id-1', text: 'AI sub-point', note: 'Keep this note', position: 2000 },
          ],
        },
      ],
      conclusion: [],
    });
    expect(onApplyOutline.mock.calls[0][0].main[0]).not.toHaveProperty('source');
    expect(onApplyOutline.mock.calls[0][0].main[0].subPoints[1]).not.toHaveProperty('source');
    expect(onApplyOutline.mock.calls[0][0].main[0].subPoints[1]).not.toHaveProperty('scratchNoteId');
    expect(onApplyOutline.mock.calls[0][1]).toEqual(['n1']);
  });

  it('shows an error toast and no success toast when an online Apply write rejects', async () => {
    const onApplyOutline = jest.fn().mockRejectedValueOnce(new Error('permission denied'));
    composePlanFromScratchMock().mockResolvedValueOnce(
      composeOutline({
        main: [
          {
            id: 'ai-point',
            scratchNoteId: 'n1',
            text: 'AI point',
            note: 'First scratch note',
            source: 'ai',
          },
        ],
      })
    );
    const { user } = renderScratchPanel({ onApplyOutline });

    await openBoard(user);
    await user.click(screen.getByRole('button', { name: 'scratch.board.compose' }));
    expect(await screen.findByText('AI point')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'scratch.board.apply' }));

    await waitFor(() => expect(toastMock().error).toHaveBeenCalledWith('permission denied'));
    expect(toastMock().success).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'scratch.board.apply' })).toBeEnabled();
  });

  it('disables compose and apply while scratch writes are pending', async () => {
    const onApplyOutline = jest.fn().mockResolvedValue(undefined);
    composePlanFromScratchMock().mockResolvedValueOnce(
      composeOutline({
        main: [
          {
            id: 'p-ai',
            scratchNoteId: 'n1',
            text: 'Fresh composed point',
            source: 'ai',
          },
        ],
      })
    );
    const { user, props, rerender } = renderScratchPanel({ onApplyOutline });

    await openBoard(user);
    await user.click(screen.getByRole('button', { name: 'scratch.board.compose' }));
    expect(await screen.findByText('Fresh composed point')).toBeInTheDocument();

    rerender(<ScratchPanel {...props} isScratchWritePending />);

    expect(screen.getByRole('button', { name: 'scratch.board.compose' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'scratch.board.apply' })).toBeDisabled();

    await user.click(screen.getByRole('button', { name: 'scratch.board.apply' }));
    expect(onApplyOutline).not.toHaveBeenCalled();
  });

  it('discards a composed response if scratch notes changed while the request was in flight', async () => {
    let resolveCompose: (outline: ComposedPlanOutline) => void = () => undefined;
    composePlanFromScratchMock().mockReturnValueOnce(
      new Promise<ComposedPlanOutline>((resolve) => {
        resolveCompose = resolve;
      })
    );
    const { user, props, rerender } = renderScratchPanel();

    await openBoard(user);
    await user.click(screen.getByRole('button', { name: 'scratch.board.compose' }));
    expect(screen.getByRole('button', { name: 'scratch.board.composing' })).toBeDisabled();

    rerender(
      <ScratchPanel
        {...props}
        notes={[{ ...baseNotes[0], text: 'Edited while composing' }, baseNotes[1]]}
        scratchRevision={1}
      />
    );

    await act(async () => {
      resolveCompose(
        composeOutline({
          main: [
            {
              id: 'stale-point',
              scratchNoteId: 'n1',
              text: 'Stale composed point',
              source: 'ai',
            },
          ],
        })
      );
    });

    await waitFor(() => expect(screen.getByRole('button', { name: 'scratch.board.compose' })).toBeEnabled());
    expect(screen.queryByText('Stale composed point')).not.toBeInTheDocument();
    expect(screen.getByText('scratch.board.composeStale')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'scratch.board.apply' })).toBeDisabled();
  });

  it('times out compose, shows an error, and re-enables the button', async () => {
    jest.useFakeTimers();
    composePlanFromScratchMock().mockReturnValueOnce(new Promise(() => undefined));
    renderScratchPanel();

    fireEvent.click(screen.getByRole('button', { name: 'Редактор плана' }));
    fireEvent.click(screen.getByRole('button', { name: 'scratch.board.compose' }));
    expect(screen.getByRole('button', { name: 'scratch.board.composing' })).toBeDisabled();

    act(() => {
      jest.advanceTimersByTime(55_000);
    });

    expect(screen.getByText('scratch.board.composeTimeout')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'scratch.board.compose' })).toBeEnabled();
  });

  it('ignores a late compose response after timeout and keeps the surfaced error', async () => {
    jest.useFakeTimers();
    let resolveCompose: (outline: ComposedPlanOutline) => void = () => undefined;
    composePlanFromScratchMock().mockReturnValueOnce(
      new Promise<ComposedPlanOutline>((resolve) => {
        resolveCompose = resolve;
      })
    );
    renderScratchPanel();

    fireEvent.click(screen.getByRole('button', { name: 'Редактор плана' }));
    fireEvent.click(screen.getByRole('button', { name: 'scratch.board.compose' }));

    act(() => {
      jest.advanceTimersByTime(55_000);
    });
    expect(screen.getByText('scratch.board.composeTimeout')).toBeInTheDocument();

    await act(async () => {
      resolveCompose(
        composeOutline({
          main: [
            {
              id: 'late-valid-point',
              scratchNoteId: 'n1',
              text: 'Late valid composed point',
              source: 'ai',
            },
          ],
        })
      );
    });

    expect(screen.queryByText('Late valid composed point')).not.toBeInTheDocument();
    expect(screen.getByText('scratch.board.composeTimeout')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'scratch.board.compose' })).toBeEnabled();
  });
});
