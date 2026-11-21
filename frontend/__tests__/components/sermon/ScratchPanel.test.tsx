import { render, screen, waitFor, act, fireEvent, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { update } from 'idb-keyval';
import React from 'react';

import ScratchPanel from '@/components/sermon/ScratchPanel';
import { resetPoolPanelForTests } from '@/components/sermon/scratch/ScratchSortingBoard';

const mockRecordingRows = new Map<string, unknown>();
jest.mock('@/providers/AuthProvider', () => ({ useAuth: () => ({ user: { uid: 'owner' }, loading: false }) }));
jest.mock('idb-keyval', () => ({
  createStore: jest.fn(() => ({})),
  get: jest.fn(async (id: string) => mockRecordingRows.get(id)),
  entries: jest.fn(async () => Array.from(mockRecordingRows.entries())),
  update: jest.fn(async (id: string, change: (old: unknown) => unknown) => { mockRecordingRows.set(id, change(mockRecordingRows.get(id))); }),
}));
beforeEach(() => {
  mockRecordingRows.clear();
  Object.defineProperty(globalThis, 'indexedDB', { configurable: true, value: {} });
});

import type { ScratchNote, SermonOutline } from '@/models/models';
import type { RecordingDraft } from '@/utils/recordingDraftStore';
import { aiUsageStub } from '@test-utils/aiUsage';


jest.mock('framer-motion', () => ({
  motion: {
    div: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) => <div {...props}>{children}</div>,
  },
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: { section?: string; count?: number }) => {
      const translations: Record<string, string> = {
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

const mockHasAiResultAttempt = jest.fn();
jest.mock('@/utils/aiResultAttempt.client', () => ({
  ...jest.requireActual('@/utils/aiResultAttempt.client'),
  hasAiResultAttempt: (...args: unknown[]) => mockHasAiResultAttempt(...args),
}));

const mockUseAiUsage = jest.fn();
jest.mock('@/hooks/useAiUsage', () => ({ useAiUsage: () => mockUseAiUsage() }));

jest.mock('@/components/AudioRecorder', () => ({
  AudioRecorder: () => <div data-testid="scratch-voice-recorder" />,
}));

const mockAutoStart = jest.fn();
let mockRecordingStateChange: (active: boolean) => void;
jest.mock('@/components/sermon/AudioRecorderPortalBridge', () => ({
  __esModule: true,
  default: function MockAudioRecorderPortalBridge({
    onRecordingComplete,
    onRetry,
    retryCount,
    maxRetries,
    transcriptionError,
    manualControl,
    manualButtonPlacement,
    isReadOnly,
    isRecorderDisabled,
    recorderTitle,
    autoStart,
    onRecordingStateChange,
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
    recorderTitle?: string;
    autoStart?: boolean;
    onRecordingStateChange: (active: boolean) => void;
  }) {
    mockRecordingStateChange = onRecordingStateChange;
    React.useEffect(() => {
      if (autoStart) mockAutoStart();
    }, [autoStart]);
    return (
      <div data-testid="scratch-capture-bridge" data-placement={manualButtonPlacement}>
        {manualControl}
        <button
          type="button"
          disabled={isReadOnly || isRecorderDisabled}
          title={recorderTitle}
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

jest.mock('@/services/thought.service', () => ({
  transcribeThoughtAudio: jest.fn(),
}));

jest.mock('@/utils/clientId', () => ({
  newClientId: jest.fn(),
}));

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

function startWithFoldedPool() {
  localStorage.setItem('scratch:poolPanel', JSON.stringify({ folded: true }));
  resetPoolPanelForTests();
}

function seedSavedRecording() {
  const blob = new Blob(['voice'], { type: 'audio/webm' });
  const draft: RecordingDraft = {
    id: 'saved-recording', ownerId: 'owner', context: 'scratch', contextId: 'sermon-1',
    blob, mimeType: blob.type, createdAt: Date.now(), sizeBytes: blob.size,
  };
  mockRecordingRows.set(draft.id, draft);
}

const poolRail = () => screen.queryByRole('button', { name: 'scratch.sort.showPool' });
const railButton = (name: string) => screen.getAllByRole('button', { name }).find((button) =>
  !screen.getByTestId('scratch-capture-bridge').contains(button))!;

function renderScratchPanel(overrides: Partial<React.ComponentProps<typeof ScratchPanel>> = {}) {
  const props: React.ComponentProps<typeof ScratchPanel> = {
    sermonId: 'sermon-1',
    notes: baseNotes,
    outline: emptyOutline,
    addScratchNote: jest.fn(),
    addRecordedScratchNote: async (text: string, _recordingId: string) => props.addScratchNote(text),
    restoreScratchNote: jest.fn(),
    updateScratchNote: jest.fn(),
    deleteScratchNote: jest.fn(),
    isScratchWritePending: false,
    placeScratchNotes: jest.fn(),
    createPointWithScratch: jest.fn(),
    addOutlinePoint: jest.fn(),
    addOutlineSubPoint: jest.fn(),
    removeOutlinePoint: jest.fn(),
    renameOutlineTitle: jest.fn(),
    removeOutlineSubPoint: jest.fn(),
    pointThoughtCount: jest.fn(() => 0),
    ...overrides,
  };

  const user = userEvent.setup();

  return {
    props,
    // These cases exercise React click handlers, not pointer geometry. Keep the
    // full user-event keyboard/type paths below, but avoid synthesizing a complete
    // pointer sequence for every state-transition click in this large suite.
    user: {
      ...user,
      click: async (element: Element) => {
        fireEvent.click(element);
        await Promise.resolve();
      },
    },
    ...render(<ScratchPanel {...props} />),
  };
}

describe('ScratchPanel', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    localStorage.removeItem('scratch:poolPanel');
    resetPoolPanelForTests();
    transcribeThoughtAudioMock().mockReset();
    mockHasAiResultAttempt.mockReset().mockResolvedValue(false);
    mockUseAiUsage.mockReturnValue(aiUsageStub());
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
    let idCounter = 0;
    newClientIdMock().mockImplementation(() => `fresh-id-${++idCounter}`);
  });

  it('disables the scratch voice recorder with the transcription quota tooltip and re-enables it when available', () => {
    mockUseAiUsage.mockReturnValue(aiUsageStub({ transcriptionBlocked: true }));

    const { unmount } = renderScratchPanel({ notes: [] });
    const blockedRecorder = screen.getByRole('button', { name: 'audio.newRecording' });
    expect(blockedRecorder).toBeDisabled();
    expect(blockedRecorder).toHaveAttribute('title', 'settings.usage.transcriptionUsageExhausted');

    unmount();
    mockUseAiUsage.mockReturnValue(aiUsageStub());

    renderScratchPanel({ notes: [] });
    expect(screen.getByRole('button', { name: 'audio.newRecording' })).toBeEnabled();
  });

  it('opens a two-line manual capture field, preserves line breaks, and leaves voice capture available', async () => {
    transcribeThoughtAudioMock().mockResolvedValueOnce({ polishedText: 'Voice scratch note' });
    const addScratchNote = jest.fn((text: string) => ({ id: `new-${text}`, text, createdAt: 'now' }));
    const { user } = renderScratchPanel({ notes: [], addScratchNote });

    expect(screen.getByTestId('scratch-capture-bridge')).toHaveAttribute('data-placement', 'right');
    expect(screen.queryByRole('textbox', { name: 'scratch.capture.manualLabel' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'audio.newRecording' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'scratch.capture.manualAdd' }));
    const input = screen.getByRole('textbox', { name: 'scratch.capture.manualLabel' });
    expect(input.tagName).toBe('TEXTAREA');
    expect(screen.getByRole('button', { name: 'scratch.capture.add' })).toBeVisible();
    fireEvent.change(input, {
      target: { value: 'Manual scratch note\nwith a second line' },
    });

    expect(addScratchNote).not.toHaveBeenCalled();
    expect(input).toHaveValue('Manual scratch note\nwith a second line');

    await user.click(screen.getByRole('button', { name: 'scratch.capture.add' }));
    expect(addScratchNote).toHaveBeenCalledWith('Manual scratch note\nwith a second line');
    expect(screen.getByRole('textbox', { name: 'scratch.capture.manualLabel' })).toHaveValue('');
    // Scratch currently owns this write only in an in-memory serial queue. That
    // queue vanishes on reload, so adding the local note must not claim it was saved.
    expect(toastMock().success).not.toHaveBeenCalledWith(
      'scratch.capture.manualSuccess',
      expect.anything()
    );

    fireEvent.change(screen.getByRole('textbox', { name: 'scratch.capture.manualLabel' }), {
      target: { value: 'Second scratch note' },
    });
    await user.click(screen.getByRole('button', { name: 'scratch.capture.add' }));
    expect(addScratchNote).toHaveBeenCalledWith('Second scratch note');
    expect(screen.getByRole('textbox', { name: 'scratch.capture.manualLabel' })).toBeInTheDocument();

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('textbox', { name: 'scratch.capture.manualLabel' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'audio.newRecording' }));
    await waitFor(() => expect(addScratchNote).toHaveBeenCalledWith('Voice scratch note'));
    expect(transcribeThoughtAudioMock()).toHaveBeenCalledTimes(1);
  });

  it('renders a note on a point as plain neutral body text, not as a styled reminder', () => {
    const outline: SermonOutline = { introduction: [], main: [{ id: 'p1', text: 'Point one' }], conclusion: [] };
    renderScratchPanel({ outline, notes: [{ id: 'n1', text: 'First scratch note', createdAt: 'now', section: 'main', outlinePointId: 'p1' }] });

    const card = screen.getByTestId('scratch-sketch-n1');
    const words = within(card).getByText('First scratch note');
    expect(words.closest('div')).not.toHaveClass('italic');
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
    expect(screen.queryByRole('button', { name: 'scratch.card.edit' })).not.toBeInTheDocument();

    await user.click(screen.getByText('First scratch note'));
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
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

  /**
   * A thought that arrives while the plan is being arranged used to cost a trip
   * back to the capture screen and another one forward. Recording and the manual
   * note now sit in the board's pool, so the plan never has to be left.
   */
  it('offers recording and the manual note on the board itself', () => {
    const outline: SermonOutline = {
      introduction: [{ id: 'existing-intro', text: 'Existing intro point' }],
      main: [{ id: 'existing-main', text: 'Existing main point' }],
      conclusion: [],
    };
    renderScratchPanel({ outline });

    const board = screen.getByTestId('scratch-sorting-board');
    expect(within(board).getByRole('button', { name: 'audio.newRecording' })).toBeEnabled();
    expect(within(board).getByRole('button', { name: 'scratch.capture.manualAdd' })).toBeEnabled();
    expect(screen.getByTestId('scratch-sketch-n1')).toBeInTheDocument();
  });

  it('opens the folded pool when the saved audio draft loads and folds it again after discard', async () => {
    startWithFoldedPool();
    seedSavedRecording();
    const { user } = renderScratchPanel();
    expect(poolRail()).toBeInTheDocument();

    expect(await screen.findByText('audio.draft.title')).toBeInTheDocument();
    await waitFor(() => expect(poolRail()).not.toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: 'audio.draft.discard' }));
    await user.click(await screen.findByRole('button', { name: 'common.delete' }));

    await waitFor(() => expect(poolRail()).toBeInTheDocument());
    expect(screen.queryByText('audio.draft.title')).not.toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem('scratch:poolPanel') ?? '{}')).toMatchObject({ folded: true });
  });

  it('folds after a failed recovered recording is discarded even though its error remains', async () => {
    startWithFoldedPool();
    seedSavedRecording();
    transcribeThoughtAudioMock().mockRejectedValueOnce(new Error('Transcription failed'));
    const { user } = renderScratchPanel();
    await user.click(await screen.findByRole('button', { name: 'audio.draft.resend' }));
    await waitFor(() => expect(toastMock().error).toHaveBeenCalledTimes(1));
    await user.click(await screen.findByRole('button', { name: 'audio.draft.discard' }));
    await user.click(await screen.findByRole('button', { name: 'common.delete' }));

    await waitFor(() => expect(poolRail()).toBeInTheDocument());
    expect(screen.queryByText('audio.draft.title')).not.toBeInTheDocument();
  });

  it('keeps the pool open during voice processing and while inline recovery is the only card', async () => {
    startWithFoldedPool();
    let rejectSave!: (error: Error) => void;
    jest.mocked(update).mockImplementationOnce(() => new Promise<void>((_resolve, reject) => { rejectSave = reject; }));
    const { user } = renderScratchPanel();
    const record = within(screen.getByTestId('scratch-capture-bridge')).getByRole('button', { name: 'audio.newRecording' });
    await user.click(record);
    expect(poolRail()).not.toBeInTheDocument();

    await act(async () => { rejectSave(new Error('Recording storage did not accept the draft')); });
    const recovery = await screen.findByTestId('audio-recovery-panel');
    expect(screen.queryByText('audio.draft.title')).not.toBeInTheDocument();
    expect(poolRail()).not.toBeInTheDocument();

    await user.click(within(recovery).getByRole('button', { name: 'audio.discardRecording' }));
    await waitFor(() => expect(poolRail()).toBeInTheDocument());
    expect(recovery).not.toBeInTheDocument();
  });

  it('can start recording from the rail again as soon as the previous recording ends', async () => {
    startWithFoldedPool();
    const { user } = renderScratchPanel();
    await user.click(railButton('audio.newRecording'));
    expect(mockAutoStart).toHaveBeenCalledTimes(1);

    act(() => mockRecordingStateChange(true));
    expect(screen.queryByRole('button', { name: 'scratch.sort.hidePool' })).not.toBeInTheDocument();
    act(() => mockRecordingStateChange(false));
    await user.click(screen.getByRole('button', { name: 'scratch.sort.hidePool' }));
    await user.click(railButton('audio.newRecording'));
    expect(mockAutoStart).toHaveBeenCalledTimes(2);
  });

  it('does not pass a pending voice start to a recorder mounted for another sermon', async () => {
    startWithFoldedPool();
    const { user, props, rerender } = renderScratchPanel();
    await user.click(railButton('audio.newRecording'));
    expect(mockAutoStart).toHaveBeenCalledTimes(1);

    rerender(<ScratchPanel {...props} sermonId="sermon-2" />);
    rerender(<ScratchPanel {...props} />);
    expect(mockAutoStart).toHaveBeenCalledTimes(1);
  });

  it('can request a new voice start after an unacknowledged request expires', async () => {
    jest.useFakeTimers();
    try {
      startWithFoldedPool();
      const { user } = renderScratchPanel();
      await user.click(railButton('audio.newRecording'));
      expect(mockAutoStart).toHaveBeenCalledTimes(1);

      await act(async () => { await jest.advanceTimersByTimeAsync(1500); });
      await user.click(screen.getByRole('button', { name: 'scratch.sort.hidePool' }));
      await user.click(railButton('audio.newRecording'));
      expect(mockAutoStart).toHaveBeenCalledTimes(2);
    } finally {
      jest.useRealTimers();
    }
  });

  it.each([
    { formState: 'closed', alreadyOpen: false },
    { formState: 'open', alreadyOpen: true },
  ])('focuses the note field from the rail when the form is $formState', async ({ alreadyOpen }) => {
    const { user } = renderScratchPanel();
    if (alreadyOpen) {
      await user.click(screen.getByRole('button', { name: 'scratch.capture.manualAdd' }));
      fireEvent.change(screen.getByRole('textbox', { name: 'scratch.capture.manualLabel' }), { target: { value: 'Keep this draft' } });
    }

    await user.click(screen.getByRole('button', { name: 'scratch.sort.hidePool' }));
    const pencil = railButton('scratch.capture.manualAdd');
    pencil.focus();
    await user.keyboard('{Enter}');

    const field = screen.getByRole('textbox', { name: 'scratch.capture.manualLabel' });
    expect(field).toHaveFocus();
    expect(field).toHaveValue(alreadyOpen ? 'Keep this draft' : '');
  });

  it('files a note through the «Move to…» menu — the path without dragging', async () => {
    const outline: SermonOutline = {
      introduction: [],
      main: [{ id: 'existing-main', text: 'Existing main point', subPoints: [{ id: 'existing-sub', text: 'Existing sub-point', position: 1000 }] }],
      conclusion: [],
    };
    const { user, props } = renderScratchPanel({ outline });

    const card = screen.getByTestId('scratch-sketch-n1');
    // Two buttons carry the label: the wide-screen menu and the phone's sheet opener; CSS picks one.
    await user.click(within(card).getAllByRole('button', { name: 'scratch.sort.moveTo' })[0]);
    await user.click(await screen.findByRole('menuitem', { name: /Existing sub-point/ }));

    expect(props.placeScratchNotes).toHaveBeenCalledWith(
      ['n1'],
      { section: 'main', pointId: 'existing-main', subPointId: 'existing-sub' },
      undefined,
    );
  });
});
