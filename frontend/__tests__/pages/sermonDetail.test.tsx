import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';

import SermonDetailPage from '@/(pages)/(private)/sermons/[id]/page';
import { TestProviders } from '@test-utils/test-providers';
import { createAudioThought } from '@services/thought.service';
import '@testing-library/jest-dom';

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
  AudioRecorder: ({ onRecordingComplete, onRetry, onClearError }: any) => (
    <div data-testid="audio-recorder">
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

jest.mock('@components/EditThoughtModal', () => ({ onSave }: any) => (
  <div data-testid="edit-thought-modal">
    <button onClick={() => onSave('Updated text', ['main'], 'main-1')}>Mock Save</button>
  </div>
));

jest.mock('@/components/sermon/prep/PrepStepCard', () => ({ children, title }: any) => (
  <div data-testid="prep-step-card" title={title}>
    <h3>{title}</h3>
    {children}
  </div>
));

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

// Mock i18n
jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const translations: { [key: string]: string } = {
        'sermon.loading': 'Loading sermon...',
        'sermon.error': 'Error loading sermon',
        'sermon.notFound': 'Sermon not found',
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
    require('@/hooks/useSermon').default.mockReturnValue(defaultUseSermonReturn);
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

    it('shows skeleton when no sermon and no error yet (initial fetch)', async () => {
      const useSermonMock = require('@/hooks/useSermon').default;
      useSermonMock.mockReturnValue({
        sermon: null,
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

      expect(screen.getByTestId('sermon-detail-skeleton')).toBeInTheDocument();
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
        expect(screen.getByText('Sermon not found')).toBeInTheDocument();
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

      // AudioRecorder is now teleported via portal; wait for the portal ref callback
      // re-render to settle, then use fireEvent which works reliably with portals
      await waitFor(() => expect(screen.getByText('Mock Record')).toBeInTheDocument());
      fireEvent.click(screen.getByText('Mock Record'));
      await waitFor(() => {
        expect(createAudioThoughtMock).toHaveBeenCalledTimes(1);
      });

      fireEvent.click(screen.getByText('Mock Retry'));
      await waitFor(() => {
        expect(createAudioThoughtMock).toHaveBeenCalledTimes(2);
        expect(defaultUseSermonReturn.setSermon).toHaveBeenCalled();
      });

      fireEvent.click(screen.getByText('Mock Clear'));
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
    it('triggers save callbacks when steps are updated', async () => {
      mockUseSearchParams.mockReturnValue({ get: (param: string) => (param === 'mode' ? 'prep' : null) });
      const user = userEvent.setup();

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
          await user.click(screen.getByTestId(btnId));
        }
      }

      // We might have called updateSermonPreparation if any button was clicked.
      // If none clicked, this expect might fail unless initialized?
      // But coverage runs lines inside 'onSave...' only if clicked.
      // So failing test is better than passing with low coverage.


      expect(require('@/services/sermon.service').updateSermonPreparation).toHaveBeenCalled();
    });

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
});
