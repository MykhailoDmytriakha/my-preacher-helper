import { render, screen, waitFor, fireEvent, within, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';

import SermonDetailPage from '@/(pages)/(private)/sermons/[id]/page';
import { createBrowserDataEngine } from '@/data-engine/browser.client';
import { DataEngineProvider } from '@/data-engine/react.client';
import { TestProviders } from '@test-utils/test-providers';
import { createAudioThought } from '@services/thought.service';
import '@testing-library/jest-dom';

import { documentEngineHarness, settleEngine } from '../../test-utils/documentEngineHarness';

import type { DocumentData, EngineMetadata } from '@/data-engine/types';

/**
 * The sermon page runs on the data engine in every deployment: it renders inside a document provider
 * and reads and writes the sermon through engine hooks. These tests open the page over the real
 * document engine (only the server and the browser transport are replaced), so a click on the screen
 * is checked against the document the server ends up holding.
 */

jest.mock('@/data-engine/browser.client', () => ({ createBrowserDataEngine: jest.fn() }));
jest.mock('idb-keyval', () => ({ createStore: jest.fn() }));
jest.mock('firebase/firestore', () => ({
  doc: jest.fn(() => ({})),
  onSnapshot: jest.fn(() => jest.fn()),
}));
jest.mock('@/config/firebaseClientDb', () => ({ getClientDb: () => ({}) }));

// Render portals inline so AudioRecorder stays in the React tree without DOM moves
jest.mock('react-dom', () => ({
  ...jest.requireActual('react-dom'),
  createPortal: (node: React.ReactNode) => node,
}));

let routeId = 'sermon-123';
const mockUseSearchParams = jest.fn();
jest.mock('next/navigation', () => ({
  useParams: () => ({ id: routeId }),
  useSearchParams: () => mockUseSearchParams(),
  useRouter: () => ({
    push: jest.fn(),
    replace: jest.fn(),
    prefetch: jest.fn(),
  }),
}));

const mockSaveRecordingDraft = jest.fn();
const mockDeleteRecordingDraft = jest.fn();
jest.mock('@/utils/recordingDraftStore', () => ({
  ...jest.requireActual('@/utils/recordingDraftStore'),
  saveRecordingDraft: (...args: unknown[]) => mockSaveRecordingDraft(...args),
  deleteRecordingDraft: (...args: unknown[]) => mockDeleteRecordingDraft(...args),
}));

jest.mock('@components/AudioRecorder', () => ({
  AudioRecorder: ({ onRecordingComplete, onRetry, onClearError, onDiscardRecording, splitLeft, transcriptionError }: any) => (
    <div data-testid={splitLeft ? "classic-audio-recorder" : "scratch-audio-recorder"}>
      {transcriptionError && <p data-testid="transcription-error">{jest.requireActual('@/utils/actionFailureMessage').sayFailure(transcriptionError, (key: string) => key)}</p>}
      <button onClick={() => onRecordingComplete?.(new Blob(['test']))}>Mock Record</button>
      <button onClick={() => onRetry?.()}>Mock Retry</button>
      <button onClick={() => onClearError?.()}>Mock Clear</button>
      {/* The real recorder clears the error itself before every retry. */}
      <button onClick={() => { onClearError?.(); onRetry?.(); }}>Mock Clear Then Retry</button>
      {/* "Delete recording": the recorder clears, then says the deletion was deliberate. */}
      <button onClick={() => { onClearError?.(); onDiscardRecording?.(); }}>Mock Delete Recording</button>
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

jest.mock('@/components/sermon/ThoughtList', () => ({ onDelete, onEditStart, onThoughtOutlinePointChange }: any) => (
  <div data-testid="thought-list">
    <button onClick={() => onDelete?.('thought-1')}>Mock Delete</button>
    <button onClick={() => onEditStart?.({ id: 'thought-1', text: 'Hello', tags: [] }, 0)}>Mock Edit Start</button>
    <button onClick={() => onThoughtOutlinePointChange?.({ id: 'thought-1', text: 'Hello', tags: ['introduction'], outlinePointId: 'intro-1' }, 'main-1', null)}>Mock Move</button>
  </div>
));

// The editor itself is covered by EngineThoughtModal.test.tsx; here only which thought the page opens it for.
let mockEngineThoughtModalProps: any = null;
jest.mock('@/components/thought/EngineThoughtModal', () => ({
  EngineThoughtModal: (props: any) => {
    mockEngineThoughtModalProps = props;
    return <div data-testid="engine-thought-modal" data-thought-id={props.thoughtId ?? ''} />;
  },
}));

// The scratch workspace has its own engine tests (EngineScratchWorkspace.test.tsx).
jest.mock('@/(pages)/(private)/sermons/[id]/components/EngineScratchWorkspace', () => ({
  EngineScratchWorkspace: () => <div data-testid="scratch-panel">Scratch Panel</div>,
}));

jest.mock('@/components/sermon/prep/PrepStepCard', () => ({ children, title }: any) => (
  <div data-testid="prep-step-card" title={title}>
    <h3>{title}</h3>
    {children}
  </div>
));

// The page reads the signed-in uid as the owner of the document it opens.
jest.mock('@/providers/AuthProvider', () => ({
  useAuth: () => ({ user: { uid: 'u1' }, loading: false }),
  AuthProvider: ({ children }: { children: React.ReactNode }) => children,
}));

jest.mock('@services/firebaseAuth.service', () => ({
  auth: { currentUser: { uid: 'u1' } },
}));

jest.mock('@/services/thought.service', () => ({
  createAudioThought: jest.fn(),
}));

// Prep components that call back with fixed values, to see what the page stores
jest.mock('@/components/sermon/prep/TextContextStepContent', () => ({
  onSavePassageSummary,
  onToggleReadWholeBookOnce,
  onSaveContextNotes,
  onSaveRepeatedWords,
  onSaveVerse,
}: any) => (
  <div>
    <button data-testid="save-passage-summary" onClick={() => onSavePassageSummary('summary')}>Save Summary</button>
    <button data-testid="toggle-read-book" onClick={() => onToggleReadWholeBookOnce(true)}>Toggle Read Book</button>
    <button data-testid="save-context-notes" onClick={() => onSaveContextNotes('context-notes')}>Save Context Notes</button>
    <button data-testid="save-repeated-words" onClick={() => onSaveRepeatedWords(['word'])}>Save Repeated Words</button>
    <button data-testid="save-verse" onClick={() => onSaveVerse('Acts 1:8')}>Save Verse</button>
  </div>
));
jest.mock('@/components/sermon/prep/ExegeticalPlanStepContent', () => ({
  onEdit,
  onSaveAuthorIntent,
}: any) => (
  <div>
    <button data-testid="save-exegetical" onClick={() => onEdit((nodes: unknown[]) => [...nodes, { id: 'n1', title: 'Node', children: [] }])}>Save Exegetical</button>
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
    <button data-testid="save-goal-type" onClick={() => onSaveGoalType('didactic')}>Save Goal Type</button>
  </div>
));
jest.mock('@/components/sermon/prep/ThesisStepContent', () => ({
  onSaveHomiletical,
  onSaveExegetical,
  onSavePluralKey,
  onSaveTransitionSentence,
  onSaveOneSentence,
  onSaveSermonInOneSentence,
  onSaveQuestionWord,
  onSaveWhyPreach,
  onSaveImpactOnChurch,
  onSavePracticalQuestions,
}: any) => (
  <div>
    <button data-testid="save-question-word" onClick={() => onSaveQuestionWord?.('question')}>Save Question Word</button>
    <button data-testid="save-why-preach" onClick={() => onSaveWhyPreach?.('why')}>Save Why Preach</button>
    <button data-testid="save-impact-on-church" onClick={() => onSaveImpactOnChurch?.('impact')}>Save Impact</button>
    <button data-testid="save-practical-questions" onClick={() => onSavePracticalQuestions?.('practical')}>Save Practical</button>
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
    <button data-testid="save-updated-plan" onClick={() => onSaveUpdatedPlan([{ id: 'u1', title: 'updated' }])}>Save Updated Plan</button>
    <button data-testid="save-sermon-plan" onClick={() => onSaveSermonPlan([{ id: 's1', title: 'sermon plan' }])}>Save Sermon Plan</button>
  </div>
));
jest.mock('@/components/sermon/prep/SpiritualStepContent', () => () => <div data-testid="spiritual-step">Spiritual Step</div>);

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

const mockLocalStorage = {
  getItem: jest.fn(),
  setItem: jest.fn(),
  removeItem: jest.fn(),
};
Object.defineProperty(window, 'localStorage', {
  value: mockLocalStorage,
});

// The sermon page shows its three modes as panes on one 300%-wide track and slides it:
// prep x = 0% (no transform), classic x = -33.333333%, raw x = -66.666667%.
const PREP_PANE_OFFSET = 'none';
const CLASSIC_PANE_OFFSET = 'translateX(-33.333333%)';
const paneTrack = () => Array.from(document.querySelectorAll<HTMLElement>('div')).find(el => el.style.width === '300%');

const resource = { collection: 'sermons', id: 'sermon-123' };
const storedSermon: DocumentData = {
  userId: 'u1',
  title: 'Test Sermon',
  verse: 'John 3:16',
  date: '2023-01-01',
  thoughts: [],
  isPreached: false,
  preparation: {},
  structure: { introduction: [], main: [], conclusion: [] },
  outline: { introduction: [], main: [], conclusion: [] },
};
const metadata: EngineMetadata = { protocol: 1, generation: 'g1', revision: 1, deleted: false };

let harness: ReturnType<typeof documentEngineHarness>;
function openSermon(overrides: DocumentData = {}, options?: { cached?: boolean }) {
  harness = documentEngineHarness({ resource, value: { ...storedSermon, ...overrides }, metadata }, options);
  jest.mocked(createBrowserDataEngine).mockImplementation(harness.createBrowser);
}
const renderPage = () => render(
  <TestProviders><DataEngineProvider><SermonDetailPage /></DataEngineProvider></TestProviders>
);
const prepMode = () => mockUseSearchParams.mockReturnValue({ get: (param: string) => (param === 'mode' ? 'prep' : null) });
const storedPreparation = () => (harness.server.value?.preparation ?? {}) as Record<string, any>;

describe('Sermon Detail Page', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    routeId = 'sermon-123';
    mockLocalStorage.getItem.mockReturnValue(null);
    mockEngineThoughtModalProps = null;
    mockUseSearchParams.mockReturnValue({ get: () => null });
    openSermon();
  });

  describe('Basic Rendering', () => {
    beforeEach(() => { renderPage(); });

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
        // BrainstormModule is hidden by default, only the trigger button is visible
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

  describe('UI Mode Management', () => {
    beforeEach(() => { renderPage(); });

    it('starts in classic mode by default', async () => {
      // The page slides one 300%-wide track across its three panes; classic is the middle one.
      await waitFor(() => expect(paneTrack()?.style.transform).toBe(CLASSIC_PANE_OFFSET));
      expect(screen.getByLabelText('brainstorm.title')).toBeInTheDocument();
    });

    it('renders mode toggle button', async () => {
      await waitFor(() => {
        expect(screen.getByText(/Switch to/)).toBeInTheDocument();
      });
    });
  });

  describe('localStorage Persistence', () => {
    it('restores the mode saved for this sermon when the URL names none', async () => {
      mockLocalStorage.getItem.mockImplementation((key: string) => (key === 'sermon-sermon-123-mode' ? 'prep' : null));
      renderPage();
      // Prep is the first pane: the track is not shifted at all.
      await waitFor(() => expect(paneTrack()?.style.transform).toBe(PREP_PANE_OFFSET));
    });
  });

  describe('Data Loading', () => {
    it('shows skeleton while the first answer can still arrive', async () => {
      openSermon({}, { cached: false });
      // No copy on this device and the server has not answered yet.
      jest.mocked(harness.transport.read).mockImplementation(() => new Promise(() => undefined));
      renderPage();
      expect(await screen.findByTestId('sermon-detail-skeleton')).toBeInTheDocument();
    });

    it('loads the stored sermon on mount', async () => {
      renderPage();
      await waitFor(() => expect(screen.getByText('Test Sermon')).toBeInTheDocument());
      expect(screen.queryByTestId('sermon-detail-skeleton')).not.toBeInTheDocument();
    });

    it('renders prep content when URL has mode=prep', async () => {
      prepMode();
      renderPage();
      await waitFor(() => {
        expect(screen.getByText(/Meditation Before Preparation|wizard\.steps\.spiritual\.title/)).toBeInTheDocument();
      });
    });

    it('stops waiting and says so when the sermon is gone, with a way back to the list', async () => {
      harness = documentEngineHarness({ resource, value: null, metadata: { ...metadata, deleted: true } });
      jest.mocked(createBrowserDataEngine).mockImplementation(harness.createBrowser);
      renderPage();

      await waitFor(() => {
        expect(screen.getByText('Sermon not found or unavailable')).toBeInTheDocument();
      });
      expect(screen.queryByTestId('sermon-detail-skeleton')).not.toBeInTheDocument();
      expect(screen.getByRole('link', { name: 'Back to list' })).toHaveAttribute('href', '/sermons');
    });

    it('opens a sermon whose stored document has no thoughts list', async () => {
      const { thoughts: _thoughts, ...withoutThoughts } = storedSermon;
      harness = documentEngineHarness({ resource, value: withoutThoughts, metadata });
      jest.mocked(createBrowserDataEngine).mockImplementation(harness.createBrowser);
      renderPage();

      await waitFor(() => expect(screen.getByText('Test Sermon')).toBeInTheDocument());
      expect(screen.getAllByTestId('thought-list').length).toBeGreaterThan(0);
    });
  });

  describe('Thoughts', () => {
    const thought = { id: 'thought-1', text: 'Hello', tags: ['introduction'], outlinePointId: 'intro-1', date: '2024-01-01' };
    const withThought = {
      thoughts: [thought],
      structure: { introduction: ['thought-1'], main: [], conclusion: [] },
      thoughtsBySection: { introduction: ['thought-1'], main: [], conclusion: [] },
      outline: {
        introduction: [{ id: 'intro-1', text: 'Intro point' }],
        main: [{ id: 'main-1', text: 'Main point' }],
        conclusion: [],
      },
    };

    it('opens the thought editor for the thought the person picked', async () => {
      openSermon(withThought);
      renderPage();
      fireEvent.click((await screen.findAllByText('Mock Edit Start'))[0]);

      expect(await screen.findByTestId('engine-thought-modal')).toHaveAttribute('data-thought-id', 'thought-1');
      expect(mockEngineThoughtModalProps.sermonId).toBe('sermon-123');
      act(() => mockEngineThoughtModalProps.onClose());
      await waitFor(() => expect(screen.queryByTestId('engine-thought-modal')).not.toBeInTheDocument());
    });

    it('removes a deleted thought from the stored sermon and from its section', async () => {
      openSermon(withThought);
      renderPage();
      fireEvent.click((await screen.findAllByText('Mock Delete'))[0]);

      await waitFor(() => expect((harness.server.value as any).thoughts).toEqual([]));
      expect((harness.server.value as any).structure.introduction).toEqual([]);
    });

    it('moves a thought to another outline point and its new section in the stored sermon', async () => {
      openSermon(withThought);
      renderPage();
      fireEvent.click((await screen.findAllByText('Mock Move'))[0]);

      await waitFor(() => expect((harness.server.value as any).thoughts[0].outlinePointId).toBe('main-1'));
      expect((harness.server.value as any).structure.main).toEqual(['thought-1']);
      expect((harness.server.value as any).structure.introduction).toEqual([]);
    });
  });

  describe('Audio Recorder', () => {
    it('retries transcription after initial failure', async () => {
      const createAudioThoughtMock = createAudioThought as jest.Mock;
      createAudioThoughtMock
        .mockRejectedValueOnce(new Error('Transcription failed'))
        .mockResolvedValueOnce({ id: 'thought-1', text: 'Hello', tags: [] });
      renderPage();

      // The raw scratch pane stays mounted in the 3-pane track, so scope to the classic recorder.
      const classicRecorder = await screen.findByTestId('classic-audio-recorder');
      fireEvent.click(within(classicRecorder).getByText('Mock Record'));
      await waitFor(() => expect(createAudioThoughtMock).toHaveBeenCalledTimes(1));
      expect(await within(classicRecorder).findByTestId('transcription-error')).toBeInTheDocument();

      // The server stores a transcribed thought itself; once the retry succeeds the page reads the document again.
      const reads = jest.mocked(harness.transport.read).mock.calls.length;
      fireEvent.click(within(classicRecorder).getByText('Mock Retry'));
      await waitFor(() => expect(createAudioThoughtMock).toHaveBeenCalledTimes(2));
      await waitFor(() => expect(within(classicRecorder).queryByTestId('transcription-error')).not.toBeInTheDocument());
      await waitFor(() => expect(jest.mocked(harness.transport.read).mock.calls.length).toBeGreaterThan(reads));

      fireEvent.click(within(classicRecorder).getByText('Mock Clear'));
    });

    it('says no answer came in time for a recording instead of printing HTTP 504', async () => {
      (createAudioThought as jest.Mock).mockRejectedValueOnce(Object.assign(new Error('Transcription failed (attempt 1/4): HTTP 504'), { status: 504 }));
      renderPage();
      const classicRecorder = await screen.findByTestId('classic-audio-recorder');
      fireEvent.click(within(classicRecorder).getByText('Mock Record'));
      expect(await within(classicRecorder).findByTestId('transcription-error')).toHaveTextContent('errors.aiOutOfTimeAudio');
      expect(within(classicRecorder).queryByText(/HTTP 504/)).toBeNull();
    });

    /**
     * The answer to a dictation can come back after the person has moved on. The request keeps
     * running, the page does not — and the recording used to live only in the page.
     */
    it('parks a failed recording even when the answer arrives after the page is gone', async () => {
      mockSaveRecordingDraft.mockReset().mockResolvedValue('draft-1');
      let fail!: (error: Error) => void;
      (createAudioThought as jest.Mock).mockImplementationOnce(() => new Promise((_resolve, reject) => { fail = reject; }));
      const view = renderPage();
      const classicRecorder = await screen.findByTestId('classic-audio-recorder');
      fireEvent.click(within(classicRecorder).getByText('Mock Record'));
      await waitFor(() => expect(createAudioThought).toHaveBeenCalled());

      view.unmount();
      await act(async () => { fail(new Error('Transcription failed')); });

      await waitFor(() => expect(mockSaveRecordingDraft).toHaveBeenCalledWith(expect.objectContaining({ context: 'sermon', contextId: 'sermon-123' })));
    });

    it('lets the parked copy go only once the retry has made it a thought', async () => {
      mockSaveRecordingDraft.mockReset().mockResolvedValue(undefined);
      mockDeleteRecordingDraft.mockReset().mockResolvedValue(undefined);
      let succeed!: (value: unknown) => void;
      (createAudioThought as jest.Mock)
        .mockRejectedValueOnce(new Error('Transcription failed'))
        .mockImplementationOnce(() => new Promise(resolve => { succeed = resolve; }));
      renderPage();
      const classicRecorder = await screen.findByTestId('classic-audio-recorder');
      fireEvent.click(within(classicRecorder).getByText('Mock Record'));
      await waitFor(() => expect(mockSaveRecordingDraft).toHaveBeenCalledTimes(1));
      const parkedId = mockSaveRecordingDraft.mock.calls[0][0].id;

      // The recorder clears the error first; the parked copy must outlive that until the answer.
      fireEvent.click(within(classicRecorder).getByText('Mock Clear Then Retry'));
      await waitFor(() => expect(createAudioThought).toHaveBeenCalledTimes(2));
      expect(mockDeleteRecordingDraft).not.toHaveBeenCalled();

      await act(async () => { succeed({ id: 'thought-1', text: 'Hello', tags: [] }); });
      await waitFor(() => expect(mockDeleteRecordingDraft).toHaveBeenCalledWith(parkedId));
    });

    it('lets the parked copy go when the person deletes the recording', async () => {
      mockSaveRecordingDraft.mockReset().mockResolvedValue(undefined);
      mockDeleteRecordingDraft.mockReset().mockResolvedValue(undefined);
      (createAudioThought as jest.Mock).mockRejectedValueOnce(new Error('Transcription failed'));
      renderPage();
      const classicRecorder = await screen.findByTestId('classic-audio-recorder');
      fireEvent.click(within(classicRecorder).getByText('Mock Record'));
      await waitFor(() => expect(mockSaveRecordingDraft).toHaveBeenCalledTimes(1));
      const parkedId = mockSaveRecordingDraft.mock.calls[0][0].id;

      fireEvent.click(within(classicRecorder).getByText('Mock Delete Recording'));
      await waitFor(() => expect(mockDeleteRecordingDraft).toHaveBeenCalledWith(parkedId));
    });

    it('keeps a failed recording parked when a new one is started', async () => {
      mockSaveRecordingDraft.mockReset().mockResolvedValue(undefined);
      mockDeleteRecordingDraft.mockReset().mockResolvedValue(undefined);
      (createAudioThought as jest.Mock)
        .mockRejectedValueOnce(new Error('Transcription failed'))
        .mockResolvedValueOnce({ id: 'thought-2', text: 'Second', tags: [] });
      renderPage();
      const classicRecorder = await screen.findByTestId('classic-audio-recorder');
      fireEvent.click(within(classicRecorder).getByText('Mock Record'));
      await waitFor(() => expect(mockSaveRecordingDraft).toHaveBeenCalledTimes(1));
      const parkedId = mockSaveRecordingDraft.mock.calls[0][0].id;

      // Starting a new recording clears the error, then records again.
      fireEvent.click(within(classicRecorder).getByText('Mock Clear'));
      fireEvent.click(within(classicRecorder).getByText('Mock Record'));
      await waitFor(() => expect(createAudioThought).toHaveBeenCalledTimes(2));
      await waitFor(() => expect(mockDeleteRecordingDraft).toHaveBeenCalled());
      expect(mockDeleteRecordingDraft).not.toHaveBeenCalledWith(parkedId);
    });
  });

  describe('Accessibility', () => {
    beforeEach(() => { renderPage(); });

    it('has proper heading structure', async () => {
      await waitFor(() => {
        expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();
        expect(screen.getAllByRole('heading', { level: 2 }).length).toBeGreaterThan(0);
      });
    });

    it('provides mode switching controls', async () => {
      await waitFor(() => {
        expect(screen.getByText(/Switch to/)).toBeInTheDocument();
      });
    });
  });

  describe('Prep Mode Interactions', () => {
    // Each prep step stores its own field of the stored preparation, never the whole object from a render.
    it('stores every prep step answer in the sermon document', async () => {
      prepMode();
      renderPage();
      expect((await screen.findAllByTestId('prep-step-card')).length).toBeGreaterThan(0);

      const buttons = [
        'save-passage-summary', 'toggle-read-book', 'save-context-notes', 'save-repeated-words', 'save-verse',
        'save-exegetical', 'save-author-intent', 'save-main-idea', 'save-context-idea', 'save-argumentation',
        'save-goals', 'save-timeless-truth', 'save-christ-connection', 'save-goal-type',
        'save-thesis', 'save-thesis-exegetical', 'save-plural-key', 'save-transition-sentence', 'save-one-sentence',
        'save-sermon-one-sentence', 'save-homiletic', 'save-updated-plan', 'save-sermon-plan',
      ];
      for (const testId of buttons) {
        fireEvent.click(screen.getByTestId(testId));
        // One answer after another, as a person fills the steps in.
        await act(async () => { await settleEngine(); await settleEngine(); });
      }

      await waitFor(() => expect(storedPreparation().homileticPlan?.sermonPlan).toEqual([{ id: 's1', title: 'sermon plan' }]), { timeout: 8000 });
      await waitFor(() => expect(harness.server.value?.verse).toBe('Acts 1:8'));
      const prep = storedPreparation();
      expect(prep.textContext).toEqual({ passageSummary: 'summary', readWholeBookOnceConfirmed: true, contextNotes: 'context-notes', repeatedWords: ['word'] });
      expect(prep.authorIntent).toBe('intent');
      expect(prep.mainIdea).toEqual({ textIdea: 'idea', contextIdea: 'context idea', argumentation: 'argumentation' });
      expect(prep.preachingGoal).toEqual({ statement: 'goal', type: 'didactic' });
      expect(prep.timelessTruth).toBe('truth');
      expect(prep.christConnection).toBe('connection');
      expect(prep.thesis).toMatchObject({ homiletical: 'thesis', exegetical: 'exegetical', pluralKey: 'plural', transitionSentence: 'transition', oneSentence: 'one sentence', sermonInOneSentence: 'sermon one sentence' });
      expect(prep.homileticPlan).toEqual({ modernTranslation: 'translation', updatedPlan: [{ id: 'u1', title: 'updated' }], sermonPlan: [{ id: 's1', title: 'sermon plan' }] });
      // The exegetical plan edit lands in the document too (the document applies it to its newest plan).
      await waitFor(() => expect(storedPreparation().exegeticalPlan).toEqual([{ id: 'n1', title: 'Node', children: [] }]));
    }, 30_000);

    // BUG-20261011-thesis-answers-save-nowhere: four fields of the thesis step showed Save while the page
    // gave them nothing to save with, so the words went nowhere.
    it('saves every answer of the thesis step that has a Save button', async () => {
      prepMode();
      renderPage();
      const saved = async (testId: string) => {
        fireEvent.click(await screen.findByTestId(testId));
        return waitFor(() => {
          const thesis = storedPreparation().thesis;
          expect(thesis).toBeDefined();
          return thesis;
        });
      };
      await saved('save-question-word');
      await waitFor(() => expect(storedPreparation().thesis.questionWord).toBe('question'));
      await saved('save-why-preach');
      await waitFor(() => expect(storedPreparation().thesis.homileticalAnswers.whyPreach).toBe('why'));
      await saved('save-impact-on-church');
      // Each answer keeps the ones saved before it.
      await waitFor(() => expect(storedPreparation().thesis.homileticalAnswers).toMatchObject({ whyPreach: 'why', impactOnChurch: 'impact' }));
      await saved('save-practical-questions');
      await waitFor(() => expect(storedPreparation().thesis.homileticalAnswers).toEqual({ whyPreach: 'why', impactOnChurch: 'impact', practicalQuestions: 'practical' }));
      expect(storedPreparation().thesis.questionWord).toBe('question');
    }, 30_000);

    it('leaves a step answered on another device alone when a different step is saved', async () => {
      prepMode();
      openSermon({ preparation: { authorIntent: 'rewritten on the phone this morning' } });
      // A leftover copy from a failed save of an older build must not ride along either.
      mockLocalStorage.getItem.mockImplementation((key: string) => (key === 'prep-draft-backup-sermon-123'
        ? JSON.stringify({ authorIntent: 'STALE text from a failed save' }) : null));
      renderPage();

      fireEvent.click(await screen.findByTestId('save-context-notes'));
      await waitFor(() => expect(storedPreparation().textContext?.contextNotes).toBe('context-notes'));
      expect(storedPreparation().authorIntent).toBe('rewritten on the phone this morning');
      expect(screen.queryByTestId('restore-prep-draft')).not.toBeInTheDocument();
    }, 15_000);

    it('keeps the saved text apart from a sibling written elsewhere in between', async () => {
      prepMode();
      renderPage();
      const user = userEvent.setup();
      await user.click(await screen.findByTestId('save-context-notes'));
      await waitFor(() => expect(storedPreparation().textContext?.contextNotes).toBe('context-notes'));
      // Another device writes a sibling field; this page then saves its own field.
      await act(async () => { await harness.remote({ preparation: { ...storedPreparation(), textContext: { ...storedPreparation().textContext, passageSummary: 'From the phone' } } }); });
      await user.click(screen.getByTestId('save-repeated-words'));
      await waitFor(() => expect(storedPreparation().textContext?.repeatedWords).toEqual(['word']));
      expect(storedPreparation().textContext).toMatchObject({ contextNotes: 'context-notes', passageSummary: 'From the phone' });
    }, 15_000);
  });
});
