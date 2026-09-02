import { render, screen, waitFor, fireEvent, within, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';

import SermonDetailPage from '@/(pages)/(private)/sermons/[id]/page';
import { TestProviders } from '@test-utils/test-providers';
import { createAudioThought, createManualThought, updateThought } from '@services/thought.service';
import { applyScratchToOutlineViaClient } from '@/services/sermons.client';
import { updateSermonOutline } from '@/services/outline.service';
import { mergeOutline } from '@/utils/mergeOutline';
import '@testing-library/jest-dom';

import type { ScratchNote, SermonOutline } from '@/models/models';

let mockFirestoreSnapshotNext: ((snapshot: {
  exists: () => boolean;
  data: () => { thoughts: Array<{ id: string }> };
}) => void) | null = null;
const mockFirestoreUnsubscribe = jest.fn();

jest.mock('firebase/firestore', () => ({
  doc: jest.fn((_db: unknown, collectionName: string, id: string) => ({ collectionName, id })),
  onSnapshot: jest.fn((_ref: unknown, _options: unknown, next: typeof mockFirestoreSnapshotNext) => {
    mockFirestoreSnapshotNext = next;
    return mockFirestoreUnsubscribe;
  }),
}));

jest.mock('@/config/firebaseClientDb', () => ({ getClientDb: () => ({}) }));

// Render portals inline so AudioRecorder stays in the React tree without DOM moves
jest.mock('react-dom', () => ({
  ...jest.requireActual('react-dom'),
  createPortal: (node: React.ReactNode) => node,
}));

// Mock next/navigation - useSearchParams overridable per test
const mockUseSearchParams = jest.fn();
jest.mock('next/navigation', () => ({
  useParams: () => ({ id: 'sermon-123' }),
  useSearchParams: () => mockUseSearchParams(),
  useRouter: () => ({
    push: jest.fn(),
    replace: jest.fn(),
    prefetch: jest.fn(),
  }),
}));

// Mock child components with simpler implementations

jest.mock('@components/AudioRecorder', () => ({
  AudioRecorder: ({ onRecordingComplete, onRetry, onClearError, splitLeft }: any) => (
    <div data-testid={splitLeft ? "classic-audio-recorder" : "scratch-audio-recorder"}>
      <button onClick={() => onRecordingComplete?.(new Blob(['test']))}>Mock Record</button>
      <button onClick={() => onRetry?.()}>Mock Retry</button>
      <button onClick={() => onClearError?.()}>Mock Clear</button>
    </div>
  ),
}));

jest.mock('@/components/sermon/SermonHeader', () => ({ sermon, uiMode, onModeChange }: any) => (
  <div data-testid="sermon-header">
    <h1>{sermon?.title || 'No Title'}</h1>
    <button onClick={() => onModeChange(uiMode === 'classic' ? 'prep' : 'classic')}>
      Switch to {uiMode === 'classic' ? 'Prep' : 'Classic'} Mode
    </button>
  </div>
));

jest.mock('@/components/sermon/SermonOutline', () => ({ uiMode }: any) => (
  <div data-testid="sermon-outline" data-mode={uiMode || 'classic'}>
    <h2>Sermon SermonOutline</h2>
    <p>Mode: {uiMode || 'classic'}</p>
  </div>
));

jest.mock('@/components/sermon/BrainstormModule', () => ({ uiMode }: any) => (
  <div data-testid="brainstorm-module" data-mode={uiMode || 'classic'}>
    <h2>Brainstorm Module</h2>
    <p>Mode: {uiMode || 'classic'}</p>
  </div>
));

jest.mock('@/components/sermon/KnowledgeSection', () => ({ uiMode }: any) => (
  <div data-testid="knowledge-section" data-mode={uiMode || 'classic'}>
    <h2>Knowledge Section</h2>
    <p>Mode: {uiMode || 'classic'}</p>
  </div>
));

jest.mock('@/components/sermon/ThoughtList', () => ({ onDelete, onEditStart }: any) => (
  <div data-testid="thought-list">
    <button onClick={() => onDelete?.('thought-1')}>Mock Delete</button>
    <button onClick={() => onEditStart?.({ id: 'thought-1', text: 'Hello', tags: [] }, 0)}>Mock Edit Start</button>
  </div>
));

let mockCreateThoughtModalProps: any = null;
let mockEditThoughtModalProps: any = null;
jest.mock('@components/CreateThoughtModal', () => ({
  __esModule: true,
  default: (props: any) => {
    mockCreateThoughtModalProps = props;
    return null;
  },
}));

jest.mock('@components/EditThoughtModal', () => ({ onSave, ...props }: any) => {
  mockEditThoughtModalProps = { onSave, ...props };
  return (
    <div data-testid="edit-thought-modal">
      <button onClick={() => onSave('Updated text', ['main'], 'main-1')}>Mock Save</button>
    </div>
  );
});

jest.mock('@/components/sermon/prep/PrepStepCard', () => ({ children, title }: any) => (
  <div data-testid="prep-step-card" title={title}>
    <h3>{title}</h3>
    {children}
  </div>
));

let mockScratchPanelProps: {
  onApplyOutline?: (outline: SermonOutline, consumedNoteIds: string[]) => void | Promise<void>;
  onOutlineChange?: (outline: SermonOutline) => void | Promise<void>;
  updateScratchNote?: (noteId: string, patch: { text?: string; section?: ScratchNote['section'] | null }) => void;
} = {};

jest.mock('@/components/sermon/ScratchPanel', () => ({
  __esModule: true,
  default: (props: {
    onApplyOutline?: (outline: SermonOutline, consumedNoteIds: string[]) => void | Promise<void>;
    onOutlineChange?: (outline: SermonOutline) => void | Promise<void>;
    updateScratchNote?: (noteId: string, patch: { text?: string; section?: ScratchNote['section'] | null }) => void;
  }) => {
    mockScratchPanelProps = props;
    return <div data-testid="scratch-panel">Scratch Panel</div>;
  },
}));

// The page reads the signed-in uid to address its durable drafts; TestProviders has
// no AuthProvider, so without this the draft paths are silently skipped and a test
// about them would pass while proving nothing.
jest.mock('@/providers/AuthProvider', () => ({
  useAuth: () => ({ user: { uid: 'u1' }, loading: false }),
  AuthProvider: ({ children }: { children: React.ReactNode }) => children,
}));

/**
 * The LIVE identity, mutable on purpose. Late-refusal reporters ask who is signed in at
 * the moment they speak — a hook value cannot answer that after unmount — so tests that
 * cover "the person left / signed out" must be able to change it.
 */
let signedInUid: string | undefined = 'u1';
jest.mock('@services/firebaseAuth.service', () => ({
  auth: {
    get currentUser() {
      return signedInUid ? { uid: signedInUid } : null;
    },
  },
}));

jest.mock('@/hooks/useSermon', () => ({
  __esModule: true,
  default: jest.fn().mockReturnValue({
    sermon: {
      id: 'sermon-123',
      title: 'Test Sermon',
      verse: 'John 3:16',
      date: '2023-01-01',
      thoughts: [],
      isPreached: false,
      preparation: {},
      structure: { introduction: [], main: [], conclusion: [] },
      outline: { introduction: [], main: [], conclusion: [] }, // detailed outline structure might be needed
    },
    loading: false,
    setSermon: jest.fn(),
    refreshSermon: jest.fn(),
    getSortedThoughts: jest.fn().mockReturnValue([]),
    error: null,
  }),
}));

// Mock services
jest.mock('@/services/thought.service', () => ({
  createAudioThought: jest.fn(),
  createManualThought: jest.fn(),
  deleteThought: jest.fn(),
  updateThought: jest.fn(),
}));

// Mock prep components to test callbacks
jest.mock('@/components/sermon/prep/TextContextStepContent', () => ({
  onSavePassageSummary,
  onToggleReadWholeBookOnce,
  onSaveContextNotes,
  onSaveRepeatedWords,
}: any) => (
  <div>
    <button data-testid="save-passage-summary" onClick={() => onSavePassageSummary('summary')}>Save Summary</button>
    <button data-testid="toggle-read-book" onClick={() => onToggleReadWholeBookOnce(true)}>Toggle Read Book</button>
    <button data-testid="save-context-notes" onClick={() => onSaveContextNotes('context-notes')}>Save Context Notes</button>
    <button data-testid="save-repeated-words" onClick={() => onSaveRepeatedWords(['word'])}>Save Repeated Words</button>
  </div>
));
jest.mock('@/components/sermon/prep/ExegeticalPlanStepContent', () => ({
  onChange,
  onSave,
  onSaveAuthorIntent,
}: any) => (
  <div>
    <button data-testid="change-exegetical" onClick={() => onChange([{ id: 'n1', title: 'node', children: [] }])}>Change Exegetical</button>
    <button data-testid="save-exegetical" onClick={() => onSave([])}>Save Exegetical</button>
    <button data-testid="save-author-intent" onClick={() => onSaveAuthorIntent('intent')}>Save Author Intent</button>
  </div>
));
jest.mock('@/components/sermon/prep/MainIdeaStepContent', () => ({
  onSaveTextIdea,
  onSaveContextIdea,
  onSaveArgumentation,
}: any) => (
  <div>
    <button data-testid="save-main-idea" onClick={() => onSaveTextIdea('idea')}>Save Main Idea</button>
    <button data-testid="save-context-idea" onClick={() => onSaveContextIdea('context idea')}>Save Context Idea</button>
    <button data-testid="save-argumentation" onClick={() => onSaveArgumentation('argumentation')}>Save Argumentation</button>
  </div>
));
jest.mock('@/components/sermon/prep/GoalsStepContent', () => ({
  onSaveGoalStatement,
  onSaveTimelessTruth,
  onSaveChristConnection,
  onSaveGoalType,
}: any) => (
  <div>
    <button data-testid="save-goals" onClick={() => onSaveGoalStatement('goal')}>Save Goal</button>
    <button data-testid="save-timeless-truth" onClick={() => onSaveTimelessTruth('truth')}>Save Timeless Truth</button>
    <button data-testid="save-christ-connection" onClick={() => onSaveChristConnection('connection')}>Save Christ Connection</button>
    <button data-testid="save-goal-type" onClick={() => onSaveGoalType('know')}>Save Goal Type</button>
  </div>
));
jest.mock('@/components/sermon/prep/ThesisStepContent', () => ({
  onSaveHomiletical,
  onSaveExegetical,
  onSavePluralKey,
  onSaveTransitionSentence,
  onSaveOneSentence,
  onSaveSermonInOneSentence,
}: any) => (
  <div>
    <button data-testid="save-thesis" onClick={() => onSaveHomiletical('thesis')}>Save Thesis</button>
    <button data-testid="save-thesis-exegetical" onClick={() => onSaveExegetical('exegetical')}>Save Thesis Exegetical</button>
    <button data-testid="save-plural-key" onClick={() => onSavePluralKey('plural')}>Save Plural Key</button>
    <button data-testid="save-transition-sentence" onClick={() => onSaveTransitionSentence('transition')}>Save Transition Sentence</button>
    <button data-testid="save-one-sentence" onClick={() => onSaveOneSentence('one sentence')}>Save One Sentence</button>
    <button data-testid="save-sermon-one-sentence" onClick={() => onSaveSermonInOneSentence('sermon one sentence')}>Save Sermon One Sentence</button>
  </div>
));
jest.mock('@/components/sermon/prep/HomileticPlanStepContent', () => ({
  onSaveModernTranslation,
  onSaveUpdatedPlan,
  onSaveSermonPlan,
}: any) => (
  <div>
    <button data-testid="save-homiletic" onClick={() => onSaveModernTranslation('translation')}>Save Homiletic</button>
    <button data-testid="save-updated-plan" onClick={() => onSaveUpdatedPlan(['updated'])}>Save Updated Plan</button>
    <button data-testid="save-sermon-plan" onClick={() => onSaveSermonPlan(['sermon plan'])}>Save Sermon Plan</button>
  </div>
));
jest.mock('@/components/sermon/prep/SpiritualStepContent', () => () => <div data-testid="spiritual-step">Spiritual Step</div>);


// Mock services
jest.mock('@/services/sermon.service', () => ({
  getSermonById: jest.fn().mockResolvedValue({
    id: 'sermon-123',
    title: 'Test Sermon',
    verse: 'John 3:16',
    date: '2023-01-01',
    thoughts: [],
    isPreached: false,
  }),
  updateSermonPreparation: jest.fn().mockResolvedValue({}),
}));

jest.mock('@/services/structure.service', () => ({
  updateStructure: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('@/services/outline.service', () => ({
  updateSermonOutline: jest.fn(),
}));

jest.mock('@/services/sermons.client', () => ({
  applyScratchToOutlineViaClient: jest.fn(),
  addScratchNoteViaClient: jest.fn(),
  updateScratchNoteViaClient: jest.fn(),
  deleteScratchNoteViaClient: jest.fn(),
}));

// Mock i18n
jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const translations: { [key: string]: string } = {
        'sermon.loading': 'Loading sermon...',
        'sermon.error': 'Error loading sermon',
        'sermon.notFound': 'Sermon not found or unavailable',
        'sermon.unavailableOffline': 'No connection and no local copy of this sermon',
        'sermon.backToList': 'Back to list',
        'filters.filter': 'Filter',
        'filters.activeFilters': 'Active filters',
        'filters.clear': 'Clear',
      };
      return translations[key] || key;
    },
  }),
}));

// Mock localStorage
const mockLocalStorage = {
  getItem: jest.fn(),
  setItem: jest.fn(),
  removeItem: jest.fn(),
};
Object.defineProperty(window, 'localStorage', {
  value: mockLocalStorage,
});

const defaultUseSermonReturn = {
  sermon: {
    id: 'sermon-123',
    title: 'Test Sermon',
    verse: 'John 3:16',
    date: '2023-01-01',
    thoughts: [],
    isPreached: false,
    preparation: {},
    structure: { introduction: [], main: [], conclusion: [] },
    outline: { introduction: [], main: [], conclusion: [] },
  },
  loading: false,
  setSermon: jest.fn(),
  refreshSermon: jest.fn(),
  getSortedThoughts: jest.fn().mockReturnValue([]),
  error: null,
};

describe('Sermon Detail Page', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockLocalStorage.getItem.mockReturnValue(null);
    mockScratchPanelProps = {};
    mockCreateThoughtModalProps = null;
    mockEditThoughtModalProps = null;
    mockFirestoreSnapshotNext = null;
    mockFirestoreUnsubscribe.mockClear();
    require('@/hooks/useSermon').default.mockReturnValue(defaultUseSermonReturn);
    const sermonsClient = require('@/services/sermons.client');
    sermonsClient.addScratchNoteViaClient.mockResolvedValue([]);
    sermonsClient.updateScratchNoteViaClient.mockResolvedValue([]);
    sermonsClient.deleteScratchNoteViaClient.mockResolvedValue([]);
    (updateSermonOutline as jest.Mock).mockResolvedValue({ introduction: [], main: [], conclusion: [] });
    mockUseSearchParams.mockReturnValue({ get: (param: string) => (param === 'mode' ? null : null) });
  });

  describe('Basic Rendering', () => {
    beforeEach(() => {
      render(
        <TestProviders>
          <SermonDetailPage />
        </TestProviders>
      );
    });

    it('renders the sermon header', async () => {
      await waitFor(() => {
        expect(screen.getByTestId('sermon-header')).toBeInTheDocument();
        expect(screen.getByText('Test Sermon')).toBeInTheDocument();
      });
    });

    it('renders the sermon outline by default', async () => {
      await waitFor(() => {
        expect(screen.getByTestId('sermon-outline')).toBeInTheDocument();
        expect(screen.getByText('Sermon SermonOutline')).toBeInTheDocument();
      });
    });

    it('renders the brainstorm trigger button', async () => {
      await waitFor(() => {
        // BrainstormModule is now hidden by default, only the trigger button is visible
        expect(screen.getByLabelText('brainstorm.title')).toBeInTheDocument();
      });
    });

    it('shows BrainstormModule when brainstorm button is clicked', async () => {
      const user = userEvent.setup();

      await waitFor(() => {
        expect(screen.getByLabelText('brainstorm.title')).toBeInTheDocument();
      });

      await user.click(screen.getByLabelText('brainstorm.title'));

      await waitFor(() => {
        expect(screen.getByTestId('brainstorm-module')).toBeInTheDocument();
      });
    });

    it('renders the knowledge section', async () => {
      await waitFor(() => {
        expect(screen.getByTestId('knowledge-section')).toBeInTheDocument();
        expect(screen.getByText('Knowledge Section')).toBeInTheDocument();
      });
    });

  });

  describe('Manual thought persistence acceptance', () => {
    it('says NOTHING when the refusal lands after someone else has signed in', async () => {
    /**
     * The privacy case a frozen snapshot could not catch. These reporters live in
     * closures that outlive the page and the session, so they must read who is signed in
     * NOW: after A leaves and B signs in, A's dictated text must never appear on B's
     * screen — and the sign-out sweep cannot help, because this message would be created
     * after it ran.
     */
    const { toast } = require('sonner') as { toast: { error: jest.Mock } };
    const toastError = jest.spyOn(toast, 'error').mockImplementation(() => 'toast-id');
    let rejectUpdate!: (error: unknown) => void;
    (updateThought as jest.Mock).mockReturnValue(
      new Promise((_resolve, reject) => {
        rejectUpdate = reject;
      })
    );
    require('@/hooks/useSermon').default.mockReturnValue({
      ...defaultUseSermonReturn,
      sermon: {
        ...defaultUseSermonReturn.sermon,
        thoughts: [{ id: 'thought-1', text: 'Hello', tags: [], date: '2026-08-11' }],
      },
    });

    const { unmount } = render(<TestProviders><SermonDetailPage /></TestProviders>);
    fireEvent.click((await screen.findAllByText('Mock Edit Start'))[0]);
    await waitFor(() => expect(mockEditThoughtModalProps).not.toBeNull());

    let submission!: { acceptance: Promise<unknown>; persistence: Promise<void> };
    act(() => {
      submission = mockEditThoughtModalProps.onSave('Private words of the first account', ['main'], 'main-1');
    });
    void submission.acceptance.catch(() => undefined);

    unmount();
    // Someone else is at this browser now.
    signedInUid = 'somebody-else';

    await act(async () => {
      rejectUpdate(
        Object.assign(new Error('Missing or insufficient permissions.'), {
          code: 'permission-denied',
          name: 'FirebaseError',
        })
      );
      await submission.persistence.catch(() => undefined);
    });

    expect(toastError).not.toHaveBeenCalled();
    toastError.mockRestore();
    signedInUid = 'u1';
  });

  it('still tells the person about a refusal that lands after they left the page', async () => {
      // The silence this pins down: a refusal arriving after navigation used to reopen an
      // editor nobody renders, so the edit vanished from the document without a word.
      const { toast } = require('sonner') as { toast: { error: jest.Mock } };
      const toastError = jest.spyOn(toast, 'error').mockImplementation(() => 'toast-id');
      let rejectUpdate!: (error: unknown) => void;
      (updateThought as jest.Mock).mockReturnValue(
        new Promise((_resolve, reject) => {
          rejectUpdate = reject;
        })
      );
      require('@/hooks/useSermon').default.mockReturnValue({
        ...defaultUseSermonReturn,
        sermon: {
          ...defaultUseSermonReturn.sermon,
          thoughts: [{ id: 'thought-1', text: 'Hello', tags: [], date: '2026-08-11' }],
        },
      });

      const { unmount } = render(<TestProviders><SermonDetailPage /></TestProviders>);
      fireEvent.click((await screen.findAllByText('Mock Edit Start'))[0]);
      await waitFor(() => expect(mockEditThoughtModalProps).not.toBeNull());

      let submission!: { acceptance: Promise<unknown>; persistence: Promise<void> };
      act(() => {
        submission = mockEditThoughtModalProps.onSave('Edit made just before leaving', ['main'], 'main-1');
      });
      void submission.acceptance.catch(() => undefined);

      // The person navigates away while the write is still in flight.
      unmount();

      await act(async () => {
        rejectUpdate(
          Object.assign(new Error('Missing or insufficient permissions.'), {
            code: 'permission-denied',
            name: 'FirebaseError',
          })
        );
        await submission.persistence.catch(() => undefined);
      });

      await waitFor(() => expect(toastError).toHaveBeenCalled());
      const [, options] = toastError.mock.calls.at(-1) as [string, { description: string }];
      // The text has to travel with the message — the editor that held it is gone.
      expect(options.description).toContain('Edit made just before leaving');
      toastError.mockRestore();
    });

    it('does NOT accept a refused create, so the editor keeps what was dictated', async () => {
      // The failure this pins down: a refused create used to be indistinguishable from a
      // queued one, the modal closed, and the dictated thought was gone with no message.
      const refusal = Object.assign(new Error('Missing or insufficient permissions.'), {
        code: 'permission-denied',
        name: 'FirebaseError',
      });
      (createManualThought as jest.Mock).mockRejectedValue(refusal);

      render(
        <TestProviders>
          <SermonDetailPage />
        </TestProviders>
      );

      await waitFor(() => expect(mockCreateThoughtModalProps).not.toBeNull());
      let submission!: { acceptance: Promise<unknown>; persistence: Promise<void> };
      act(() => {
        submission = mockCreateThoughtModalProps.onCreateThought({
          text: 'Dictated thought that must survive a refusal',
          tags: [],
          date: '2026-08-11T00:00:00.000Z',
        });
      });

      let rejectedWith: unknown;
      await act(async () => {
        rejectedWith = await submission.acceptance.then(
          () => undefined,
          (error: unknown) => error
        );
      });

      // Acceptance REJECTS: the editor's catch is what keeps the text on screen.
      expect(rejectedWith).toMatchObject({ code: 'permission-denied' });
      // And the refused thought is not left drawn as if it had been saved.
      expect(
        screen.queryByText('Dictated thought that must survive a refusal')
      ).not.toBeInTheDocument();
    });

    it('accepts from the local Firestore snapshot without waiting for the server promise', async () => {
      (createManualThought as jest.Mock).mockReturnValue(new Promise(() => undefined));

      render(
        <TestProviders>
          <SermonDetailPage />
        </TestProviders>
      );

      await waitFor(() => expect(mockCreateThoughtModalProps).not.toBeNull());
      let submission: { acceptance: Promise<unknown>; persistence: Promise<void> };
      act(() => {
        submission = mockCreateThoughtModalProps.onCreateThought({
          text: 'Queued thought',
          tags: [],
          date: '2026-08-11T00:00:00.000Z',
        });
      });

      const submittedThought = (createManualThought as jest.Mock).mock.calls[0][1];
      let locallyAccepted = false;
      void submission!.acceptance.then(() => {
        locallyAccepted = true;
      });
      await act(async () => Promise.resolve());
      expect(locallyAccepted).toBe(false);

      await act(async () => {
        mockFirestoreSnapshotNext?.({
          exists: () => true,
          data: () => ({ thoughts: [submittedThought] }),
        });
        await submission!.acceptance;
      });

      expect(locallyAccepted).toBe(true);
      expect(mockFirestoreUnsubscribe).toHaveBeenCalledTimes(1);
    });

    it('accepts an exact edited payload from the local replica without waiting for the server', async () => {
      (updateThought as jest.Mock).mockReturnValue(new Promise(() => undefined));
      require('@/hooks/useSermon').default.mockReturnValue({
        ...defaultUseSermonReturn,
        sermon: {
          ...defaultUseSermonReturn.sermon,
          thoughts: [{ id: 'thought-1', text: 'Hello', tags: [], date: '2026-08-11' }],
        },
      });
      render(<TestProviders><SermonDetailPage /></TestProviders>);
      fireEvent.click((await screen.findAllByText('Mock Edit Start'))[0]);
      await waitFor(() => expect(mockEditThoughtModalProps).not.toBeNull());

      let submission!: { acceptance: Promise<unknown>; persistence: Promise<void> };
      act(() => {
        submission = mockEditThoughtModalProps.onSave('Queued exact edit', ['main'], 'main-1');
      });
      const submittedThought = (updateThought as jest.Mock).mock.calls[0][1];
      let accepted = false;
      void submission.acceptance.then(() => { accepted = true; });

      await act(async () => {
        mockFirestoreSnapshotNext?.({
          exists: () => true,
          data: () => ({ thoughts: [{ ...submittedThought, text: 'Old local text' }] }),
        });
        await Promise.resolve();
      });
      expect(accepted).toBe(false);

      await act(async () => {
        mockFirestoreSnapshotNext?.({
          exists: () => true,
          data: () => ({ thoughts: [submittedThought] }),
        });
        await submission.acceptance;
      });
      expect(accepted).toBe(true);
    });

    it('queues the exact rejected edit behind a newer editor instead of reopening on top of it', async () => {
      let rejectPersistence!: (error: Error) => void;
      (updateThought as jest.Mock).mockReturnValue(new Promise((_resolve, reject) => {
        rejectPersistence = reject;
      }));
      require('@/hooks/useSermon').default.mockReturnValue({
        ...defaultUseSermonReturn,
        sermon: {
          ...defaultUseSermonReturn.sermon,
          thoughts: [{ id: 'thought-1', text: 'Hello', tags: [], date: '2026-08-11' }],
        },
      });
      render(<TestProviders><SermonDetailPage /></TestProviders>);
      fireEvent.click((await screen.findAllByText('Mock Edit Start'))[0]);
      await waitFor(() => expect(mockEditThoughtModalProps).not.toBeNull());

      let submission!: { acceptance: Promise<unknown>; persistence: Promise<void> };
      act(() => {
        submission = mockEditThoughtModalProps.onSave('Exact rejected page edit', ['main'], 'main-1');
      });
      const submittedThought = (updateThought as jest.Mock).mock.calls[0][1];
      await act(async () => {
        mockFirestoreSnapshotNext?.({
          exists: () => true,
          data: () => ({ thoughts: [submittedThought] }),
        });
        await submission.acceptance;
      });
      act(() => mockEditThoughtModalProps.onClose());

      fireEvent.click((await screen.findAllByText('Mock Edit Start'))[0]);
      await waitFor(() => expect(mockEditThoughtModalProps.initialText).toBe('Hello'));

      await act(async () => {
        rejectPersistence(new Error('Permission denied'));
        await expect(submission.persistence).rejects.toThrow('Permission denied');
      });
      expect(mockEditThoughtModalProps.initialText).toBe('Hello');

      act(() => mockEditThoughtModalProps.onClose());
      await waitFor(() => expect(mockEditThoughtModalProps.initialText).toBe('Exact rejected page edit'));
    });
  });

  describe('UI Mode Management', () => {
    beforeEach(() => {
      render(
        <TestProviders>
          <SermonDetailPage />
        </TestProviders>
      );
    });

    it('starts in classic mode by default', async () => {
      await waitFor(() => {
        const outline = screen.getByTestId('sermon-outline');
        const knowledge = screen.getByTestId('knowledge-section');

        // BrainstormModule button is visible in classic mode
        const brainstormButton = screen.getByLabelText('brainstorm.title');

        expect(outline).toHaveAttribute('data-mode', 'classic');
        expect(knowledge).toHaveAttribute('data-mode', 'classic');
        expect(brainstormButton).toBeInTheDocument();
      });
    });

    it('renders mode toggle button', async () => {
      await waitFor(() => {
        const switchButton = screen.getByText(/Switch to/);
        expect(switchButton).toBeInTheDocument();
      });
    });
  });

  describe('localStorage Persistence', () => {
    it('restores mode from localStorage on mount', async () => {
      // Mock the correct localStorage key for sermon mode
      mockLocalStorage.getItem.mockImplementation((key) => {
        if (key === 'sermon-test-sermon-mode') {
          return 'prep';
        }
        return null;
      });

      render(
        <TestProviders>
          <SermonDetailPage />
        </TestProviders>
      );

      // The localStorage restoration logic is complex and depends on URL params
      // This test verifies the component renders without crashing
      await waitFor(() => {
        expect(screen.getByTestId('sermon-outline')).toBeInTheDocument();
      });
    });
  });

  describe('Data Loading', () => {
    it('shows skeleton while loading', async () => {
      // Override mock for this test
      const useSermonMock = require('@/hooks/useSermon').default;
      useSermonMock.mockReturnValue({
        sermon: null,
        loading: true,
        setSermon: jest.fn(),
        refreshSermon: jest.fn(),
        getSortedThoughts: jest.fn().mockReturnValue([]),
        error: null,
      });

      render(
        <TestProviders>
          <SermonDetailPage />
        </TestProviders>
      );

      expect(screen.getByTestId('sermon-detail-skeleton')).toBeInTheDocument();
    });

    /**
     * CONTRACT CHANGED 2026-07-28. "No sermon and no error" is NOT a reason to wait:
     * a refused read is PAUSED by React Query (pending, no error, forever) and an
     * offline read is disabled, so the old test — which asserted skeletons for that
     * exact state — was locking the infinite-skeleton bug in place. Waiting is now
     * driven by `awaitingFirstAnswer`: an answer that can still arrive by itself.
     */
    it('shows skeleton while an answer can still arrive', async () => {
      const useSermonMock = require('@/hooks/useSermon').default;
      useSermonMock.mockReturnValue({
        sermon: null,
        loading: false,
        awaitingFirstAnswer: true,
        setSermon: jest.fn(),
        refreshSermon: jest.fn(),
        getSortedThoughts: jest.fn().mockReturnValue([]),
        error: null,
      });

      render(
        <TestProviders>
          <SermonDetailPage />
        </TestProviders>
      );

      expect(screen.getByTestId('sermon-detail-skeleton')).toBeInTheDocument();
    });

    it('stops waiting and says so when no answer can arrive any more', async () => {
      const useSermonMock = require('@/hooks/useSermon').default;
      useSermonMock.mockReturnValue({
        sermon: null,
        loading: false,
        awaitingFirstAnswer: false,
        isOnline: true,
        setSermon: jest.fn(),
        refreshSermon: jest.fn(),
        getSortedThoughts: jest.fn().mockReturnValue([]),
        error: null,
      });

      render(
        <TestProviders>
          <SermonDetailPage />
        </TestProviders>
      );

      expect(screen.queryByTestId('sermon-detail-skeleton')).not.toBeInTheDocument();
      expect(screen.getByText('Sermon not found or unavailable')).toBeInTheDocument();
    });

    it('loads sermon data on mount', async () => {
      // Ensure mock returns data (default behavior, but good to be explicit or just rely on beforeEach reset)
      const useSermonMock = require('@/hooks/useSermon').default;
      useSermonMock.mockReturnValue({
        sermon: {
          id: 'sermon-123',
          title: 'Test Sermon',
          verse: 'John 3:16',
          date: '2023-01-01',
          thoughts: [],
          isPreached: false,
          preparation: {},
          structure: { introduction: [], main: [], conclusion: [] },
          outline: { introduction: [], main: [], conclusion: [] }
        },
        loading: false,
        setSermon: jest.fn(),
        refreshSermon: jest.fn(),
        getSortedThoughts: jest.fn().mockReturnValue([]),
        error: null,
      });

      render(
        <TestProviders>
          <SermonDetailPage />
        </TestProviders>
      );

      // Since we mocked the hook, we can checks if it was called
      expect(useSermonMock).toHaveBeenCalledWith('sermon-123');

      await waitFor(() => {
        expect(screen.getByText('Test Sermon')).toBeInTheDocument();
      });
    });

    it('passes sermon data to child components', async () => {
      render(
        <TestProviders>
          <SermonDetailPage />
        </TestProviders>
      );

      await waitFor(() => {
        expect(screen.getByText('Test Sermon')).toBeInTheDocument();
      });
    });

    it('renders prep content when URL has mode=prep', async () => {
      mockUseSearchParams.mockReturnValue({ get: (param: string) => (param === 'mode' ? 'prep' : null) });

      render(
        <TestProviders>
          <SermonDetailPage />
        </TestProviders>
      );

      // In prep mode, the first PrepStepCard shows "Meditation Before Preparation"
      await waitFor(() => {
        expect(screen.getByText(/Meditation Before Preparation|wizard\.steps\.spiritual\.title/)).toBeInTheDocument();
      });
    });

    it('shows Not Found when loading complete, no sermon, and error present', async () => {
      const useSermonMock = require('@/hooks/useSermon').default;
      useSermonMock.mockReturnValue({
        sermon: null,
        loading: false,
        awaitingFirstAnswer: false,
        isOnline: true,
        setSermon: jest.fn(),
        refreshSermon: jest.fn(),
        getSortedThoughts: jest.fn().mockReturnValue([]),
        error: new Error('Sermon not found'),
      });

      render(
        <TestProviders>
          <SermonDetailPage />
        </TestProviders>
      );

      await waitFor(() => {
        expect(screen.getByText('Sermon not found or unavailable')).toBeInTheDocument();
        expect(screen.getByText('Back to list')).toBeInTheDocument();
      });

      const backLink = screen.getByRole('link', { name: 'Back to list' });
      expect(backLink).toHaveAttribute('href', '/dashboard');
    });

    it('handles sermon with null thoughts array', async () => {
      const useSermonMock = require('@/hooks/useSermon').default;
      const sermonWithNullThoughts = {
        id: 'sermon-123',
        title: 'Test Sermon',
        verse: 'John 3:16',
        date: '2023-01-01',
        thoughts: null as unknown as never[],
        isPreached: false,
        preparation: {},
        structure: { introduction: [], main: [], conclusion: [] },
        outline: { introduction: [], main: [], conclusion: [] },
      };
      useSermonMock.mockReturnValue({
        sermon: sermonWithNullThoughts,
        loading: false,
        setSermon: jest.fn(),
        refreshSermon: jest.fn(),
        getSortedThoughts: jest.fn().mockReturnValue([]),
        error: null,
      });

      render(
        <TestProviders>
          <SermonDetailPage />
        </TestProviders>
      );

      await waitFor(() => {
        expect(screen.getByText('Test Sermon')).toBeInTheDocument();
      });
      expect(sermonWithNullThoughts.thoughts).toEqual([]);
    });
  });

  describe('Audio Recorder', () => {
    it('retries transcription after initial failure', async () => {
      const createAudioThoughtMock = createAudioThought as jest.Mock;
      createAudioThoughtMock
        .mockRejectedValueOnce(new Error('Transcription failed'))
        .mockResolvedValueOnce({ id: 'thought-1', text: 'Hello', tags: [] });

      render(
        <TestProviders>
          <SermonDetailPage />
        </TestProviders>
      );

      // The raw scratch pane stays mounted in the 3-pane track, so scope to the
      // classic recorder bridge rather than the scratch voice recorder.
      const classicRecorder = await screen.findByTestId('classic-audio-recorder');
      fireEvent.click(within(classicRecorder).getByText('Mock Record'));
      await waitFor(() => {
        expect(createAudioThoughtMock).toHaveBeenCalledTimes(1);
      });

      fireEvent.click(within(classicRecorder).getByText('Mock Retry'));
      await waitFor(() => {
        expect(createAudioThoughtMock).toHaveBeenCalledTimes(2);
        expect(defaultUseSermonReturn.setSermon).toHaveBeenCalled();
      });

      fireEvent.click(within(classicRecorder).getByText('Mock Clear'));
    });
  });

  describe('Accessibility', () => {
    beforeEach(() => {
      render(
        <TestProviders>
          <SermonDetailPage />
        </TestProviders>
      );
    });

    it('has proper heading structure', async () => {
      await waitFor(() => {
        const h1 = screen.getByRole('heading', { level: 1 });
        const h2s = screen.getAllByRole('heading', { level: 2 });

        expect(h1).toBeInTheDocument();
        expect(h2s.length).toBeGreaterThan(0);
      });
    });

    it('provides mode switching controls', async () => {
      await waitFor(() => {
        const switchButton = screen.getByText(/Switch to/);
        expect(switchButton).toBeInTheDocument();
      });
    });
  });
  describe('Prep Mode Interactions', () => {
    it('triggers save callbacks when steps are updated', () => {
      mockUseSearchParams.mockReturnValue({ get: (param: string) => (param === 'mode' ? 'prep' : null) });

      render(
        <TestProviders>
          <SermonDetailPage />
        </TestProviders>
      );



      // Verify we have prep step cards
      const cards = screen.getAllByTestId('prep-step-card');
      expect(cards.length).toBeGreaterThan(0);

      // Try to find known visible buttons
      // If passing summary not found, we skip click but assert prep update called?
      // No, we must click to call it.

      // Attempt to click all known buttons if present
      const knownButtons = [
        'save-passage-summary',
        'toggle-read-book',
        'save-context-notes',
        'save-repeated-words',
        'change-exegetical',
        'save-exegetical',
        'save-author-intent',
        'save-main-idea',
        'save-context-idea',
        'save-argumentation',
        'save-goals',
        'save-timeless-truth',
        'save-christ-connection',
        'save-goal-type',
        'save-thesis',
        'save-thesis-exegetical',
        'save-plural-key',
        'save-transition-sentence',
        'save-one-sentence',
        'save-sermon-one-sentence',
        'save-homiletic',
        'save-updated-plan',
        'save-sermon-plan',
      ];

      for (const btnId of knownButtons) {
        if (screen.queryByTestId(btnId)) {
          fireEvent.click(screen.getByTestId(btnId));
        }
      }

      // We might have called updateSermonPreparation if any button was clicked.
      // If none clicked, this expect might fail unless initialized?
      // But coverage runs lines inside 'onSave...' only if clicked.
      // So failing test is better than passing with low coverage.


      expect(require('@/services/sermon.service').updateSermonPreparation).toHaveBeenCalled();
      // This case drives ~23 sequential userEvent clicks through a full page render, so it
      // genuinely needs longer than Jest's 5s default. On a loaded machine it exceeded that
      // and went red while passing in isolation — and since the Vercel build runs the suite,
      // a flake here fails a deploy for a reason that has nothing to do with the change
      // being deployed. The work is legitimately slow; give it room instead of pretending.
    }, 30_000);

    it('updates structure when edited thought moves to a different section', async () => {
      const useSermonMock = require('@/hooks/useSermon').default;
      const setSermon = jest.fn();
      const sermonWithThought = {
        id: 'sermon-123',
        title: 'Test Sermon',
        verse: 'John 3:16',
        date: '2023-01-01',
        thoughts: [
          { id: 'thought-1', text: 'Original thought', tags: ['introduction'], outlinePointId: 'intro-1', date: '2024-01-01' },
        ],
        isPreached: false,
        preparation: {},
        structure: { introduction: ['thought-1'], main: [], conclusion: [] },
        thoughtsBySection: { introduction: ['thought-1'], main: [], conclusion: [] },
        outline: {
          introduction: [{ id: 'intro-1', text: 'Intro point' }],
          main: [{ id: 'main-1', text: 'Main point' }],
          conclusion: [{ id: 'conclusion-1', text: 'Conclusion point' }],
        },
      };
      useSermonMock.mockReturnValue({
        sermon: sermonWithThought,
        loading: false,
        setSermon,
        refreshSermon: jest.fn(),
        getSortedThoughts: jest.fn().mockReturnValue(sermonWithThought.thoughts),
        error: null,
      });

      const { deleteThought, updateThought } = require('@/services/thought.service');
      const { updateStructure } = require('@/services/structure.service');
      (deleteThought as jest.Mock).mockResolvedValue(undefined);
      (updateThought as jest.Mock).mockResolvedValue(undefined);

      render(
        <TestProviders>
          <SermonDetailPage />
        </TestProviders>
      );

      await waitFor(() => {
        expect(screen.getAllByTestId('thought-list').length).toBeGreaterThan(0);
      });

      fireEvent.click(screen.getAllByText('Mock Edit Start')[0]);
      await waitFor(() => {
        expect(screen.getByTestId('edit-thought-modal')).toBeInTheDocument();
      });
      fireEvent.click(screen.getByText('Mock Save'));

      await waitFor(() => {
        expect(updateThought).toHaveBeenCalled();
        expect(updateStructure).toHaveBeenCalled();
      });
    });
  });

  describe('Scratch Apply', () => {
    it('accepts a manual outline save ack when no Apply outline write happens in between', async () => {
      const manualDraftOutline: SermonOutline = {
        introduction: [],
        main: [{ id: 'manual-main-draft', text: 'Manual draft point' }],
        conclusion: [],
      };
      const manualSavedOutline: SermonOutline = {
        introduction: [],
        main: [{ id: 'manual-main-saved', text: 'Manual saved point' }],
        conclusion: [],
      };
      let resolveManualSave: (outline: SermonOutline) => void = () => undefined;
      (updateSermonOutline as jest.Mock).mockReturnValueOnce(
        new Promise<SermonOutline>((resolve) => {
          resolveManualSave = resolve;
        })
      );
      let currentSermon: any = {
        ...defaultUseSermonReturn.sermon,
        outline: { introduction: [], main: [], conclusion: [] },
        scratch: [],
      };
      const snapshots: any[] = [];
      const setSermon = jest.fn((updater: any) => {
        currentSermon = typeof updater === 'function' ? updater(currentSermon) : updater;
        snapshots.push(currentSermon);
      });
      const useSermonMock = require('@/hooks/useSermon').default;
      useSermonMock.mockReturnValue({
        ...defaultUseSermonReturn,
        sermon: currentSermon,
        setSermon,
      });

      render(
        <TestProviders>
          <SermonDetailPage />
        </TestProviders>
      );

      await waitFor(() => expect(mockScratchPanelProps.onOutlineChange).toBeDefined());
      const manualSavePromise = mockScratchPanelProps.onOutlineChange!(manualDraftOutline) as Promise<void>;

      await waitFor(() =>
        expect(updateSermonOutline).toHaveBeenCalledWith(
          'sermon-123',
          manualDraftOutline,
          // The plan this page loaded with, so the write merges instead of replacing.
          expect.anything(),
          // …and the collision mode this caller asks for.
          expect.anything()
        )
      );
      expect(snapshots.at(-1).outline).toEqual(manualDraftOutline);

      await act(async () => {
        resolveManualSave(manualSavedOutline);
        await manualSavePromise;
      });

      expect(snapshots.at(-1).outline).toEqual(manualSavedOutline);
    });

    /**
     * A POINT ADDED ON ANOTHER DEVICE MUST SURVIVE A PLAN SAVE FROM THIS PAGE.
     *
     * The neighbouring test proves the base is HANDED OVER; it stays green even if
     * the merge underneath is broken, because it looks at the arguments of the call.
     * This one lets the real `mergeOutline` play the server and then asks the only
     * question that matters to the person: is the phone's point still there?
     */
    it('keeps a point added on another device when the plan is saved here', async () => {
      const phonePoint = { id: 'phone-main', text: 'Added on the phone' };
      /** Stands in for the stored plan. */
      let storedOutline: SermonOutline = {
        introduction: [],
        main: [{ id: 'p1', text: 'Grace' }, phonePoint],
        conclusion: [],
      };

      (updateSermonOutline as jest.Mock).mockImplementation(
        async (
          _sermonId: string,
          mine: SermonOutline,
          base?: SermonOutline | null,
          onCollision?: 'refuse' | 'preferMine'
        ) => {
          if (base === undefined) {
            // What the unguarded path does: replace the whole field.
            storedOutline = mine;
            return storedOutline;
          }
          const { outline } = mergeOutline(base, mine, storedOutline, onCollision === 'preferMine');
          storedOutline = outline;
          return storedOutline;
        }
      );

      // This page loaded BEFORE the phone's point existed.
      let currentSermon: any = {
        ...defaultUseSermonReturn.sermon,
        outline: { introduction: [], main: [{ id: 'p1', text: 'Grace' }], conclusion: [] },
        scratch: [],
      };
      const setSermon = jest.fn((updater: any) => {
        currentSermon = typeof updater === 'function' ? updater(currentSermon) : updater;
      });
      const useSermonMock = require('@/hooks/useSermon').default;
      useSermonMock.mockReturnValue({
        ...defaultUseSermonReturn,
        sermon: currentSermon,
        setSermon,
      });

      render(
        <TestProviders>
          <SermonDetailPage />
        </TestProviders>
      );

      await waitFor(() => expect(mockScratchPanelProps.onOutlineChange).toBeDefined());
      await act(async () => {
        await mockScratchPanelProps.onOutlineChange!({
          introduction: [],
          main: [{ id: 'p1', text: 'Grace, revised here' }],
          conclusion: [],
        });
      });

      // The edit landed...
      expect(storedOutline.main.map((point) => point.text)).toContain('Grace, revised here');
      // ...and the phone's point was not swept away with it.
      expect(storedOutline.main.map((point) => point.id)).toContain('phone-main');
    });

    /**
     * A FAILED SAVE MUST NOT BECOME THE STORY OF WHAT WAS SAVED.
     *
     * The plan is shown the moment it is edited, before the server confirms — right,
     * or every keystroke would wait on the network. What is NOT right is treating
     * that unconfirmed plan as "what I started from" on the next save.
     *
     * Sequence: the server holds [a]. A point `x` is added here and the save FAILS,
     * but the screen keeps showing [a,x]. Then `y` is added. If the second save
     * states [a,x] as its starting point, the merge sees `x` missing on the server,
     * reads that as "deleted on the other device", and commits [a,y] — `x` is gone
     * for good, and nobody was asked. Found by an independent review 2026-08-10.
     */
    it('does not treat a plan from a FAILED save as the baseline of the next one', async () => {
      let storedOutline: SermonOutline = {
        introduction: [],
        main: [{ id: 'a', text: 'Grace' }],
        conclusion: [],
      };
      let failNextSave = true;

      (updateSermonOutline as jest.Mock).mockImplementation(
        async (
          _sermonId: string,
          mine: SermonOutline,
          base?: SermonOutline | null,
          onCollision?: 'refuse' | 'preferMine'
        ) => {
          if (failNextSave) {
            failNextSave = false;
            throw new Error('network died');
          }
          const { outline } = mergeOutline(base ?? null, mine, storedOutline, onCollision === 'preferMine');
          storedOutline = outline;
          return storedOutline;
        }
      );

      let currentSermon: any = {
        ...defaultUseSermonReturn.sermon,
        outline: { introduction: [], main: [{ id: 'a', text: 'Grace' }], conclusion: [] },
        scratch: [],
      };
      const setSermon = jest.fn((updater: any) => {
        currentSermon = typeof updater === 'function' ? updater(currentSermon) : updater;
      });
      const useSermonMock = require('@/hooks/useSermon').default;
      useSermonMock.mockReturnValue({ ...defaultUseSermonReturn, sermon: currentSermon, setSermon });

      render(
        <TestProviders>
          <SermonDetailPage />
        </TestProviders>
      );

      await waitFor(() => expect(mockScratchPanelProps.onOutlineChange).toBeDefined());

      // First save fails — the screen keeps the point, the server never got it.
      await act(async () => {
        await expect(
          mockScratchPanelProps.onOutlineChange!({
            introduction: [],
            main: [{ id: 'a', text: 'Grace' }, { id: 'x', text: 'Added here' }],
            conclusion: [],
          })
        ).rejects.toThrow('network died');
      });

      // Second save, with one more point.
      await act(async () => {
        await mockScratchPanelProps.onOutlineChange!({
          introduction: [],
          main: [
            { id: 'a', text: 'Grace' },
            { id: 'x', text: 'Added here' },
            { id: 'y', text: 'Added after the failure' },
          ],
          conclusion: [],
        });
      });

      expect(storedOutline.main.map((point) => point.id)).toContain('y');
      // The point from the failed save is not read as a deletion made elsewhere.
      expect(storedOutline.main.map((point) => point.id)).toContain('x');
    });

    /**
     * A LATE-BUT-SUCCESSFUL SAVE MUST STILL ADVANCE THE BASELINE.
     *
     * The baseline says what this screen believes is stored, and only an answered
     * save may move it. The trap is the ORDER of answers: save A leaves, save B
     * leaves and fails, and A's success arrives afterwards. A's answer is stale for
     * the SCREEN — a newer plan is on it — but it is perfectly good news about the
     * SERVER. Discarding it freezes the baseline at the plan from before A, forever.
     *
     * What that costs the person: the frozen baseline makes his own earlier wording
     * look like a fresh edit, so the next save collides with the phone's rewrite of
     * the same point and `preferMine` quietly restores the old words.
     *
     * Found by an independent review 2026-08-10.
     */
    it('advances the plan baseline on a late save answer, so a phone rewrite is not erased', async () => {
      const point = (text: string) => ({ id: 'p', text });
      let storedOutline: SermonOutline = { introduction: [], main: [point('T0')], conclusion: [] };

      let resolveFirst: (o: SermonOutline) => void = () => undefined;
      let call = 0;
      (updateSermonOutline as jest.Mock).mockImplementation(
        async (
          _id: string,
          mine: SermonOutline,
          base?: SermonOutline | null,
          onCollision?: 'refuse' | 'preferMine'
        ) => {
          call += 1;
          if (call === 1) {
            // Save A: commits T1 on the server, but its answer arrives late.
            return new Promise<SermonOutline>((resolve) => {
              resolveFirst = (o) => { storedOutline = o; resolve(o); };
            });
          }
          if (call === 2) throw new Error('network died');   // Save B fails.
          const { outline } = mergeOutline(base ?? null, mine, storedOutline, onCollision === 'preferMine');
          storedOutline = outline;
          return storedOutline;
        }
      );

      let currentSermon: any = {
        ...defaultUseSermonReturn.sermon,
        outline: { introduction: [], main: [point('T0')], conclusion: [] },
        scratch: [],
      };
      const setSermon = jest.fn((updater: any) => {
        currentSermon = typeof updater === 'function' ? updater(currentSermon) : updater;
      });
      const useSermonMock = require('@/hooks/useSermon').default;
      useSermonMock.mockReturnValue({ ...defaultUseSermonReturn, sermon: currentSermon, setSermon });

      render(<TestProviders><SermonDetailPage /></TestProviders>);
      await waitFor(() => expect(mockScratchPanelProps.onOutlineChange).toBeDefined());

      const saveA = mockScratchPanelProps.onOutlineChange!({
        introduction: [], main: [point('T1')], conclusion: [],
      }) as Promise<void>;
      await act(async () => {
        await expect(
          mockScratchPanelProps.onOutlineChange!({ introduction: [], main: [point('T1b')], conclusion: [] })
        ).rejects.toThrow('network died');
      });
      // Save A lands only now — after B already failed.
      await act(async () => {
        resolveFirst({ introduction: [], main: [point('T1')], conclusion: [] });
        await saveA.catch(() => undefined);
      });

      // The phone rewrites the same point.
      storedOutline = { introduction: [], main: [point('PHONE')], conclusion: [] };

      // An ordinary later save from this screen, carrying the wording it already has.
      await act(async () => {
        await mockScratchPanelProps.onOutlineChange!({
          introduction: [], main: [point('T1')], conclusion: [],
        });
      });

      // This screen did not touch the point since A, so the phone's words must stand.
      expect(storedOutline.main.map((p) => p.text)).toEqual(['PHONE']);
    });

    it('ignores a stale manual outline save ack that resolves after Apply writes an outline', async () => {
      const previousOutline: SermonOutline = {
        introduction: [],
        main: [{ id: 'previous-main', text: 'Previous main point' }],
        conclusion: [],
      };
      const manualDraftOutline: SermonOutline = {
        introduction: [],
        main: [{ id: 'manual-main-draft', text: 'Manual draft before apply' }],
        conclusion: [],
      };
      const staleManualAckOutline: SermonOutline = {
        introduction: [],
        main: [{ id: 'manual-main-stale', text: 'Stale manual ack' }],
        conclusion: [],
      };
      const appliedOutline: SermonOutline = {
        introduction: [],
        main: [{ id: 'applied-main', text: 'Applied main point', note: 'Scratch note' }],
        conclusion: [],
      };
      const previousScratch: ScratchNote[] = [
        { id: 'scratch-1', text: 'Scratch note', createdAt: '2026-07-05T00:00:00.000Z' },
      ];
      let resolveManualSave: (outline: SermonOutline) => void = () => undefined;
      (updateSermonOutline as jest.Mock).mockReturnValueOnce(
        new Promise<SermonOutline>((resolve) => {
          resolveManualSave = resolve;
        })
      );
      (applyScratchToOutlineViaClient as jest.Mock).mockResolvedValueOnce({
        outline: appliedOutline,
        scratch: [],
      });
      let currentSermon: any = {
        ...defaultUseSermonReturn.sermon,
        outline: previousOutline,
        scratch: previousScratch,
      };
      const snapshots: any[] = [];
      const setSermon = jest.fn((updater: any) => {
        currentSermon = typeof updater === 'function' ? updater(currentSermon) : updater;
        snapshots.push(currentSermon);
      });
      const useSermonMock = require('@/hooks/useSermon').default;
      useSermonMock.mockReturnValue({
        ...defaultUseSermonReturn,
        sermon: currentSermon,
        setSermon,
      });

      render(
        <TestProviders>
          <SermonDetailPage />
        </TestProviders>
      );

      await waitFor(() => expect(mockScratchPanelProps.onOutlineChange).toBeDefined());
      const manualSavePromise = mockScratchPanelProps.onOutlineChange!(manualDraftOutline) as Promise<void>;
      await waitFor(() =>
        expect(updateSermonOutline).toHaveBeenCalledWith(
          'sermon-123',
          manualDraftOutline,
          // The plan this page loaded with, so the write merges instead of replacing.
          expect.anything(),
          // …and the collision mode this caller asks for.
          expect.anything()
        )
      );
      expect(snapshots.at(-1).outline).toEqual(manualDraftOutline);

      const applyPromise = mockScratchPanelProps.onApplyOutline!(appliedOutline, ['scratch-1']) as Promise<void>;
      await waitFor(() =>
        expect(applyScratchToOutlineViaClient).toHaveBeenCalledWith(
          'sermon-123',
          appliedOutline,
          [],
          // The plan and the note list this apply STARTED from: both fields are
          // merged in one transaction instead of being replaced together.
          expect.objectContaining({ scratch: expect.any(Array) })
        )
      );
      await waitFor(() => expect(snapshots.at(-1).outline).toEqual(appliedOutline));
      await expect(applyPromise).resolves.toBeUndefined();

      await act(async () => {
        resolveManualSave(staleManualAckOutline);
        await manualSavePromise;
      });

      expect(snapshots.at(-1).outline).toEqual(appliedOutline);
      expect(snapshots.map((snapshot) => snapshot.outline)).not.toContainEqual(staleManualAckOutline);
    });

    it('rolls back optimistic outline and scratch state after an online apply write failure', async () => {
      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
      Object.defineProperty(navigator, 'onLine', {
        configurable: true,
        value: true,
      });
      const previousOutline: SermonOutline = {
        introduction: [],
        main: [{ id: 'previous-main', text: 'Previous main point' }],
        conclusion: [],
      };
      const previousScratch: ScratchNote[] = [
        { id: 'scratch-1', text: 'Scratch note', createdAt: '2026-07-05T00:00:00.000Z' },
      ];
      const appliedOutline: SermonOutline = {
        introduction: [],
        main: [{ id: 'applied-main', text: 'Applied main point', note: 'Scratch note' }],
        conclusion: [],
      };
      let currentSermon: any = {
        ...defaultUseSermonReturn.sermon,
        outline: previousOutline,
        scratch: previousScratch,
      };
      const snapshots: any[] = [];
      const setSermon = jest.fn((updater: any) => {
        currentSermon = typeof updater === 'function' ? updater(currentSermon) : updater;
        snapshots.push(currentSermon);
      });
      const useSermonMock = require('@/hooks/useSermon').default;
      useSermonMock.mockReturnValue({
        ...defaultUseSermonReturn,
        sermon: currentSermon,
        setSermon,
      });
      (applyScratchToOutlineViaClient as jest.Mock).mockRejectedValueOnce(new Error('permission denied'));

      render(
        <TestProviders>
          <SermonDetailPage />
        </TestProviders>
      );

      await waitFor(() => expect(mockScratchPanelProps.onApplyOutline).toBeDefined());
      mockScratchPanelProps.onApplyOutline!(appliedOutline, ['scratch-1']);

      await waitFor(() =>
        expect(applyScratchToOutlineViaClient).toHaveBeenCalledWith(
          'sermon-123',
          appliedOutline,
          [],
          // The plan and the note list this apply STARTED from: both fields are
          // merged in one transaction instead of being replaced together.
          expect.objectContaining({ scratch: expect.any(Array) })
        )
      );
      await waitFor(() => expect(snapshots[0].outline).toEqual(appliedOutline));
      expect(snapshots[0].scratch).toEqual([]);
      await waitFor(() => expect(snapshots.at(-1).outline).toEqual(previousOutline));
      expect(snapshots.at(-1).scratch).toEqual(previousScratch);
      consoleErrorSpy.mockRestore();
    });

    it('preserves a newer scratch edit made during the online apply failure gap', async () => {
      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
      Object.defineProperty(navigator, 'onLine', {
        configurable: true,
        value: true,
      });
      const previousOutline: SermonOutline = {
        introduction: [],
        main: [{ id: 'previous-main', text: 'Previous main point' }],
        conclusion: [],
      };
      const previousScratch: ScratchNote[] = [
        { id: 'scratch-1', text: 'Consumed scratch note', createdAt: '2026-07-05T00:00:00.000Z' },
        { id: 'scratch-2', text: 'Remaining scratch note', createdAt: '2026-07-05T00:01:00.000Z' },
      ];
      const remainingScratch: ScratchNote[] = [previousScratch[1]];
      const editedRemainingScratch: ScratchNote[] = [
        { ...previousScratch[1], text: 'Edited during apply gap' },
      ];
      const appliedOutline: SermonOutline = {
        introduction: [],
        main: [{ id: 'applied-main', text: 'Applied main point', note: 'Consumed scratch note' }],
        conclusion: [],
      };
      let currentSermon: any = {
        ...defaultUseSermonReturn.sermon,
        outline: previousOutline,
        scratch: previousScratch,
      };
      const snapshots: any[] = [];
      const setSermon = jest.fn((updater: any) => {
        currentSermon = typeof updater === 'function' ? updater(currentSermon) : updater;
        snapshots.push(currentSermon);
      });
      const useSermonMock = require('@/hooks/useSermon').default;
      useSermonMock.mockReturnValue({
        ...defaultUseSermonReturn,
        sermon: currentSermon,
        setSermon,
      });
      let rejectApply: (error: Error) => void = () => undefined;
      (applyScratchToOutlineViaClient as jest.Mock).mockReturnValueOnce(
        new Promise((_resolve, reject) => {
          rejectApply = reject;
        })
      );

      render(
        <TestProviders>
          <SermonDetailPage />
        </TestProviders>
      );

      await waitFor(() => expect(mockScratchPanelProps.onApplyOutline).toBeDefined());
      mockScratchPanelProps.onApplyOutline!(appliedOutline, ['scratch-1']);

      await waitFor(() => expect(snapshots[0].scratch).toEqual(remainingScratch));
      await act(async () => {
        mockScratchPanelProps.updateScratchNote?.('scratch-2', { text: 'Edited during apply gap' });
        await Promise.resolve();
        await Promise.resolve();
      });
      await waitFor(() => expect(snapshots.at(-1).scratch).toEqual(editedRemainingScratch));

      await act(async () => {
        rejectApply(new Error('permission denied'));
      });

      await waitFor(() => expect(snapshots.at(-1).outline).toEqual(previousOutline));
      expect(snapshots.at(-1).scratch).toEqual([editedRemainingScratch[0], previousScratch[0]]);
      expect(snapshots.at(-1).scratch).not.toEqual(previousScratch);
      consoleErrorSpy.mockRestore();
    });
  });

  /**
   * A LEFTOVER LOCAL COPY MUST NOT BE APPLIED BY ITSELF.
   *
   * The preparation editor merged `prep-draft-backup-<sermonId>` over the server's
   * preparation on mount — "local wins over stale remote" — so a backup left behind by
   * a failed save weeks ago silently replaced what had been written on another device
   * since, and the next save pushed it to the server. That is the exact failure the
   * durable-draft layer exists to prevent: recovered text is OFFERED, never applied.
   */
  describe('preparation: a stale local backup is not applied silently', () => {
    it('keeps the server value and does not send the leftover text', async () => {
      const user = userEvent.setup();
      const useSermonMock = require('@/hooks/useSermon').default;
      useSermonMock.mockReturnValue({
        ...defaultUseSermonReturn,
        sermon: {
          ...defaultUseSermonReturn.sermon,
          preparation: { authorIntent: 'rewritten on the phone this morning' },
        },
      });
      mockLocalStorage.getItem.mockImplementation((key: string) => {
        if (key === 'sermon-sermon-123-mode') return 'prep';
        if (key === 'prep-draft-backup-sermon-123') {
          return JSON.stringify({ authorIntent: 'STALE text from a failed save' });
        }
        return null;
      });
      mockUseSearchParams.mockReturnValue({ get: (param: string) => (param === 'mode' ? 'prep' : null) });

      render(
        <TestProviders>
          <SermonDetailPage />
        </TestProviders>
      );

      await waitFor(() => expect(screen.queryByTestId('save-context-notes')).toBeInTheDocument());
      // Edit a DIFFERENT field. The leftover copy of `authorIntent` must not ride along.
      await user.click(screen.getByTestId('save-context-notes'));

      const updateSermonPreparation = require('@/services/sermon.service').updateSermonPreparation;
      await waitFor(() => expect(updateSermonPreparation).toHaveBeenCalled());
      const [, payload, changedKeys] = updateSermonPreparation.mock.calls[0];
      expect(payload.authorIntent).toBe('rewritten on the phone this morning');
      expect(changedKeys).not.toContain('authorIntent');
    }, 15_000);

    it('OFFERS the leftover text instead, and applies it only when asked', async () => {
      // Not applying it silently is only half the fix: the text must still be
      // reachable, or "protecting" it means quietly discarding it.
      const user = userEvent.setup();
      const useSermonMock = require('@/hooks/useSermon').default;
      useSermonMock.mockReturnValue({
        ...defaultUseSermonReturn,
        sermon: {
          ...defaultUseSermonReturn.sermon,
          preparation: { authorIntent: 'rewritten on the phone this morning' },
        },
      });
      // A STATEFUL store for this one test: the shared mock does not keep what it is
      // given, and the carry from the legacy key into the durable store is exactly a
      // write followed by a read. With a forgetful mock the offer can never appear and
      // the test would pass for the wrong reason.
      const store = new Map<string, string>([
        ['prep-draft-backup-sermon-123', JSON.stringify({ authorIntent: 'STALE text from a failed save' })],
      ]);
      mockLocalStorage.getItem.mockImplementation((key: string) => {
        if (key === 'sermon-sermon-123-mode') return 'prep';
        return store.get(key) ?? null;
      });
      mockLocalStorage.setItem.mockImplementation((key: string, value: string) => {
        store.set(key, value);
      });
      mockLocalStorage.removeItem.mockImplementation((key: string) => {
        store.delete(key);
      });
      mockUseSearchParams.mockReturnValue({ get: (param: string) => (param === 'mode' ? 'prep' : null) });

      render(
        <TestProviders>
          <SermonDetailPage />
        </TestProviders>
      );

      // The offer is on screen…
      const restore = await screen.findByTestId('restore-prep-draft');
      // …and the uid-less legacy key is retired, not read again on the next mount.
      expect(mockLocalStorage.removeItem).toHaveBeenCalledWith('prep-draft-backup-sermon-123');

      await user.click(restore);
      expect(screen.queryByTestId('restore-prep-draft')).not.toBeInTheDocument();
    }, 15_000);
  });
});
