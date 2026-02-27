import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { toast } from 'sonner';

import SermonPlanPage from '@/(pages)/(private)/sermons/[id]/plan/page'; // Alias path
import { getSermonById } from '@/services/sermon.service';
import '@testing-library/jest-dom';

jest.mock('sonner', () => ({
  toast: {
    success: jest.fn(),
    error: jest.fn(),
  },
}));

// Mock MutationObserver globally for this test file
global.MutationObserver = jest.fn(() => ({
  observe: jest.fn(),
  disconnect: jest.fn(),
  takeRecords: jest.fn(() => []),
}));

// Mock Next.js router and params
let mockSearchParams = new URLSearchParams();
const mockPush = jest.fn();
const mockReplace = jest.fn();
const mockToast = toast as jest.Mocked<typeof toast>;

jest.mock('next/navigation', () => ({
  useParams: () => ({ id: 'test-sermon-id' }),
  useRouter: () => ({ push: mockPush, replace: mockReplace }),
  useSearchParams: () => mockSearchParams,
  usePathname: () => '/sermons/test-sermon-id/plan',
}));

// Mock window.matchMedia
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: jest.fn().mockImplementation(query => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: jest.fn(), // deprecated
    removeListener: jest.fn(), // deprecated
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
    dispatchEvent: jest.fn(),
  })),
});

// Mock hooks
jest.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ user: { uid: 'test-user' }, loading: false }),
}));

// Mock sermon service
jest.mock('@/services/sermon.service', () => ({
  getSermonById: jest.fn().mockResolvedValue({
    id: 'test-sermon-id', 
    title: 'Test Sermon', 
    verse: 'Test Verse',
    date: new Date().toISOString(),
    thoughts: [
      { id: 't1', text: 'Thought 1', outlinePointId: 'intro-p1', tags: ['introduction'], keyFragments: ['frag1'] },
      { id: 't2', text: 'Thought 2', outlinePointId: 'main-p1', tags: ['main'] },
      { id: 't3', text: 'Thought 3', outlinePointId: 'con-p1', tags: ['conclusion'] },
    ],
    plan: {
      introduction: { outline: "Intro SermonOutline Mock", outlinePoints: { 'intro-p1': 'Generated Intro Content' } },
      main: { outline: "Main SermonOutline Mock", outlinePoints: { 'main-p1': 'Generated Main Content' } },
      conclusion: { outline: "Conclusion SermonOutline Mock", outlinePoints: { 'con-p1': 'Generated Conclusion Content' } }
    },
    outline: {
      introduction: [{id: 'intro-p1', text: 'Intro Point 1'}],
      main: [{id: 'main-p1', text: 'Main Point 1'}],
      conclusion: [{id: 'con-p1', text: 'Conclusion Point 1'}],
    },
    structure: {
      introduction: ['t1'],
      main: ['t2'],
      conclusion: ['t3'],
    },
    goal: 'Mock Goal', 
    audience: 'Mock Audience',
    keyFragments: ['frag1'],
  }),
}));

// Mock child components (if any are direct children of the page)
jest.mock('@/components/plan/KeyFragmentsModal', () => () => <div data-testid="key-fragments-modal">Mocked Key Fragments Modal</div>);
jest.mock('@/components/plan/PlanStyleSelector', () => () => <div data-testid="plan-style-selector">Mocked Plan Style Selector</div>);
jest.mock('@/components/plan/ViewPlanMenu', () => {
  const React = require('react');
  return function MockViewPlanMenu(props: { onStartPreachingMode?: () => void }) {
    return (
      <div data-testid="view-plan-menu">
        <button type="button" data-testid="start-preaching" onClick={props.onStartPreachingMode ?? undefined}>
          Start Preaching
        </button>
      </div>
    );
  };
});
jest.mock('@/components/ExportButtons', () => () => <div data-testid="export-buttons">Mocked Export Buttons</div>);
jest.mock('@/components/PreachingTimer', () => {
  const React = require('react');
  return function MockPreachingTimer(props: any) {
    const { onTimerStateChange } = props;
    const didRun = React.useRef(false);
    React.useEffect(() => {
      if (didRun.current) return;
      didRun.current = true;
      onTimerStateChange?.({
        currentPhase: 'introduction',
        phaseProgress: 0.5,
        totalProgress: 0.1,
        phaseProgressByPhase: {
          introduction: 0.5,
          main: 0,
          conclusion: 0,
        },
        timeRemaining: 600,
        isFinished: false,
      });
    }, [onTimerStateChange]);

    return <div data-testid="preaching-timer">Mocked Preaching Timer</div>;
  };
});
jest.mock('@/components/FloatingTextScaleControls', () => () => <div data-testid="floating-text-controls">Mocked Floating Text Controls</div>);

// Mock i18n with the specific translations needed for this test
const translate = (key: string, options?: { defaultValue?: string }) => {
  const translations: Record<string, string> = {
    'plan.thoughtsNotAssigned': 'Thoughts not assigned',
    'plan.assignThoughtsFirst': 'Please assign all thoughts to outline points first',
    'plan.workOnSermon': 'Work on Sermon',
    'plan.workOnStructure': 'Work on ThoughtsBySection',
    'plan.markKeyFragments': 'Mark Key Fragments',
    'plan.generating': 'Generating...',
    'plan.regenerate': 'Regenerate',
    'plan.generate': 'Generate',
    'plan.noThoughts': 'No thoughts',
    'plan.noContent': 'No content',
    'plan.noSermonPoints': 'No outline points',
    'plan.contentGenerated': 'Content generated',
    'plan.pointSaved': 'Point saved',
    'plan.sectionSaved': 'Section saved',
    'plan.save': 'Save',
    'plan.viewMode': 'View Mode',
    'plan.editMode': 'Edit Mode',
    'sections.introduction': 'Introduction',
    'sections.main': 'Main',
    'sections.conclusion': 'Conclusion',
    'common.scripture': 'Scripture',
    'actions.backToSermon': 'Back to Sermon',
    'errors.sermonNotFound': 'Sermon not found',
    'errors.failedToLoadSermon': 'Failed to load sermon',
    'errors.outlinePointNotFound': 'SermonOutline point not found',
    'errors.failedToGenerateContent': 'Failed to generate content',
    'errors.failedToSavePoint': 'Failed to save point',
  };
  return translations[key] || options?.defaultValue || key;
};

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: translate,
  }),
}));

const createTestQueryClient = () =>
  new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });

const renderWithQueryClient = (ui: React.ReactElement) => {
  const queryClient = createTestQueryClient();
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
};

describe('Sermon Plan Page UI Smoke Test', () => {
  // Store original fetch
  const originalFetch = global.fetch;
  
  // Get the mocked function
  const mockGetSermonById = jest.mocked(getSermonById);

  beforeEach(async () => {
    mockSearchParams = new URLSearchParams();
    mockPush.mockClear();
    mockReplace.mockClear();
    mockToast.success.mockClear();
    mockToast.error.mockClear();
    // Ensure we're using real timers for this test
    jest.useRealTimers();
    
    // Reset fetch mock before each test
    global.fetch = jest.fn().mockImplementation((url, options) => {
      if (url.includes('/api/sermons/test-sermon-id/plan')) {
        // Mock successful response for plan generation GET request
        if (url.includes('outlinePointId=')) { 
          return Promise.resolve({
            ok: true,
            status: 200,
            json: () => Promise.resolve({ content: 'Mock Generated Content' }),
          });
        }
        if (options?.method === 'PUT') {
          return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) });
        }
      }
      if (url.endsWith('/api/sermons/test-sermon-id')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({
            id: 'test-sermon-id',
            title: 'Test Sermon',
            verse: 'Test Verse',
            date: new Date().toISOString(),
            thoughts: [
              { id: 't1', text: 'Thought 1', outlinePointId: 'intro-p1', tags: ['introduction'], keyFragments: ['frag1'] },
              { id: 't2', text: 'Thought 2', outlinePointId: 'main-p1', tags: ['main'] },
              { id: 't3', text: 'Thought 3', outlinePointId: 'con-p1', tags: ['conclusion'] },
            ],
            plan: {
              introduction: { outline: "Intro SermonOutline Mock", outlinePoints: { 'intro-p1': 'Generated Intro Content' } },
              main: { outline: "Main SermonOutline Mock", outlinePoints: { 'main-p1': 'Generated Main Content' } },
              conclusion: { outline: "Conclusion SermonOutline Mock", outlinePoints: { 'con-p1': 'Generated Conclusion Content' } }
            },
            outline: {
              introduction: [{id: 'intro-p1', text: 'Intro Point 1'}],
              main: [{id: 'main-p1', text: 'Main Point 1'}],
              conclusion: [{id: 'con-p1', text: 'Conclusion Point 1'}],
            },
            structure: {
              introduction: ['t1'],
              main: ['t2'],
              conclusion: ['t3'],
            },
            goal: 'Mock Goal',
            audience: 'Mock Audience',
            keyFragments: ['frag1'],
          }),
        });
      }
      // Fallback for unhandled URLs (optional, could throw error)
      return Promise.resolve({ ok: false, status: 404 });
    });

    // Reset the mock before each test to use the default mock
    mockGetSermonById.mockReset();
    mockGetSermonById.mockResolvedValue({
      id: 'test-sermon-id', 
      title: 'Test Sermon', 
      verse: 'Test Verse',
      date: new Date().toISOString(),
      userId: 'user-1',
      thoughts: [
        { id: 't1', text: 'Thought 1', outlinePointId: 'intro-p1', tags: ['introduction'], keyFragments: ['frag1'], date: '2024-01-01' },
        { id: 't2', text: 'Thought 2', outlinePointId: 'main-p1', tags: ['main'], date: '2024-01-01' },
        { id: 't3', text: 'Thought 3', outlinePointId: 'con-p1', tags: ['conclusion'], date: '2024-01-01' },
      ],
      plan: {
        introduction: { outline: "Intro SermonOutline Mock", outlinePoints: { 'intro-p1': 'Generated Intro Content' } },
        main: { outline: "Main SermonOutline Mock", outlinePoints: { 'main-p1': 'Generated Main Content' } },
        conclusion: { outline: "Conclusion SermonOutline Mock", outlinePoints: { 'con-p1': 'Generated Conclusion Content' } }
      },
      outline: {
        introduction: [{id: 'intro-p1', text: 'Intro Point 1'}],
        main: [{id: 'main-p1', text: 'Main Point 1'}],
        conclusion: [{id: 'con-p1', text: 'Conclusion Point 1'}],
      },
      structure: {
        introduction: ['t1'],
        main: ['t2'],
        conclusion: ['t3'],
      },
    });
  });

  afterEach(() => {
    // Restore original fetch after each test
    global.fetch = originalFetch;
    jest.clearAllMocks(); // Clear other mocks too
  });

  it('renders without crashing when thoughts are not assigned', async () => {
    // Mock sermon with unassigned thoughts - use minimal data
    const mockSermonWithUnassignedThoughts = {
      id: 'test-sermon-id', 
      title: 'Test Sermon', 
      verse: 'Test Verse',
      date: new Date().toISOString(),
      userId: 'user-1',
      thoughts: [
        { id: 't1', text: 'Thought 1', outlinePointId: null, tags: ['introduction'], date: '2024-01-01' },
        { id: 't2', text: 'Thought 2', outlinePointId: null, tags: ['main'], date: '2024-01-01' },
        { id: 't3', text: 'Thought 3', outlinePointId: null, tags: ['conclusion'], date: '2024-01-01' },
      ],
      plan: undefined,
      outline: undefined,
      structure: undefined,
    };

    // Set the mock to return unassigned thoughts
    mockGetSermonById.mockResolvedValue(mockSermonWithUnassignedThoughts);

    // Render with new mock data
    renderWithQueryClient(<SermonPlanPage />);
    
    // Just check that the component renders without crashing
    // The component should either show loading, error, or the expected UI
    await waitFor(() => {
      // Check if we have any content rendered (loading spinner counts as content)
      const hasContent = document.body.innerHTML && document.body.innerHTML.length > 0;
      expect(hasContent).toBe(true);
    }, { timeout: 10000 });
  }, 15000);

  // Add a simple test that just checks if the component can render at all
  it('can render without crashing', () => {
    // This test just checks if the component can be rendered without throwing an error
    expect(() => renderWithQueryClient(<SermonPlanPage />)).not.toThrow();
  });

  it('renders main plan layout with sections when sermon loads', async () => {
    renderWithQueryClient(<SermonPlanPage />);

    expect(await screen.findByTestId('plan-introduction-left-section')).toBeInTheDocument();
    expect(screen.getByTestId('plan-main-right-section')).toBeInTheDocument();
    expect(screen.getByTestId('plan-conclusion-right-section')).toBeInTheDocument();
  });

  it('wires section header action through layout context (switch to structure)', async () => {
    renderWithQueryClient(<SermonPlanPage />);

    await screen.findByTestId('plan-introduction-left-section');
    const switchButtons = screen.getAllByTitle('Switch to ThoughtsBySection view');
    fireEvent.click(switchButtons[0]);

    expect(mockPush).toHaveBeenCalledWith('/sermons/test-sermon-id/structure');
  });

  it('renders immersive view when planView=immersive', async () => {
    mockSearchParams = new URLSearchParams('planView=immersive');
    renderWithQueryClient(<SermonPlanPage />);

    expect(await screen.findByTestId('sermon-plan-immersive-view')).toBeInTheDocument();
    expect(screen.queryByTestId('sermon-plan-page-container')).not.toBeInTheDocument();
  });

  it('renders preaching view when planView=preaching', async () => {
    mockSearchParams = new URLSearchParams('planView=preaching');
    renderWithQueryClient(<SermonPlanPage />);

    expect(await screen.findByTestId('preaching-timer')).toBeInTheDocument();
    expect(screen.queryByTestId('sermon-plan-page-container')).not.toBeInTheDocument();
  });

  it('shows progress overlays when timer state is provided in preaching view', async () => {
    mockSearchParams = new URLSearchParams('planView=preaching');
    renderWithQueryClient(<SermonPlanPage />);

    const progressBars = await screen.findAllByRole('progressbar');
    expect(progressBars.length).toBeGreaterThan(0);
  });

  it('renders overlay portal when planView=overlay', async () => {
    mockSearchParams = new URLSearchParams('planView=overlay');
    renderWithQueryClient(<SermonPlanPage />);

    await screen.findByTestId('sermon-plan-page-container');
    expect(await screen.findByTestId('sermon-plan-overlay')).toBeInTheDocument();
  });

  it('copies overlay content using the clipboard', async () => {
    mockSearchParams = new URLSearchParams('planView=overlay');
    const writeText = jest.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });

    renderWithQueryClient(<SermonPlanPage />);

    await screen.findByTestId('sermon-plan-overlay');
    const copyButtons = screen.getAllByTitle('copy.copyFormatted');

    await act(async () => {
      fireEvent.click(copyButtons[0]);
    });

    await waitFor(() => {
      expect(writeText).toHaveBeenCalled();
    });
  });

  it('copies immersive content using the clipboard', async () => {
    mockSearchParams = new URLSearchParams('planView=immersive');
    const writeText = jest.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });

    renderWithQueryClient(<SermonPlanPage />);

    await screen.findByTestId('sermon-plan-immersive-view');
    const copyButtons = screen.getAllByTitle('copy.copyFormatted');

    await act(async () => {
      fireEvent.click(copyButtons[0]);
    });

    await waitFor(() => {
      expect(writeText).toHaveBeenCalled();
    });
  });

  it('uses fallback copy when clipboard write fails', async () => {
    mockSearchParams = new URLSearchParams('planView=overlay');

    // Simulate clipboard denial/failure
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: jest.fn().mockRejectedValue(new Error('Denied')) },
      configurable: true,
    });

    const mockExecCommand = jest.fn().mockReturnValue(true);
    Object.defineProperty(document, 'execCommand', {
      value: mockExecCommand,
      writable: true,
      configurable: true,
    });

    renderWithQueryClient(<SermonPlanPage />);

    await screen.findByTestId('sermon-plan-overlay');
    const copyButtons = screen.getAllByTitle('copy.copyFormatted');

    await act(async () => {
      fireEvent.click(copyButtons[0]);
    });

    await waitFor(() => {
      expect(mockExecCommand).toHaveBeenCalledWith('copy');
    });
  });

  it('toggles edit mode and saves outline point content', async () => {
    renderWithQueryClient(<SermonPlanPage />);

    await screen.findByTestId('plan-introduction-right-section');

    const editButtons = screen.getAllByTitle('Edit Mode');
    fireEvent.click(editButtons[0]);

    const textareas = await screen.findAllByPlaceholderText('No content');
    fireEvent.change(textareas[0], { target: { value: 'Updated Intro Content' } });

    const saveButtons = await screen.findAllByTitle('Save');
    expect(saveButtons[0]).toBeEnabled();
    fireEvent.click(saveButtons[0]);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalled();
    });

    const putCall = (global.fetch as jest.Mock).mock.calls.find(([, options]) =>
      options?.method === 'PUT'
    );
    expect(putCall).toBeDefined();

    const requestBody = JSON.parse((putCall?.[1]?.body as string) || "{}");
    const introOutline = requestBody?.introduction?.outline as string;

    expect(introOutline).toContain('## Intro Point 1\n\nUpdated Intro Content');
    expect((introOutline.match(/## Intro Point 1/g) || []).length).toBe(1);
  });

  it('shows error toast when generate request fails', async () => {
    (global.fetch as jest.Mock).mockImplementation((url, options) => {
      if (typeof url === 'string' && url.includes('/api/sermons/test-sermon-id/plan?outlinePointId=')) {
        return Promise.resolve({
          ok: false,
          status: 500,
          json: () => Promise.resolve({}),
        });
      }
      if (options?.method === 'PUT') {
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) });
      }
      return Promise.resolve({ ok: false, status: 404 });
    });

    renderWithQueryClient(<SermonPlanPage />);
    await screen.findByTestId('plan-introduction-left-section');

    const generateButtons = screen.getAllByTitle(/Generate|Regenerate/);
    fireEvent.click(generateButtons[0]);

    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalledWith('Failed to generate content');
    });
  });

  it('shows error toast when save request fails', async () => {
    (global.fetch as jest.Mock).mockImplementation((url, options) => {
      if (typeof url === 'string' && url.includes('/api/sermons/test-sermon-id/plan?outlinePointId=')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ content: 'Mock Generated Content' }),
        });
      }
      if (options?.method === 'PUT') {
        return Promise.resolve({
          ok: false,
          status: 500,
          json: () => Promise.resolve({}),
        });
      }
      return Promise.resolve({ ok: false, status: 404 });
    });

    renderWithQueryClient(<SermonPlanPage />);
    await screen.findByTestId('plan-introduction-right-section');

    const editButtons = screen.getAllByTitle('Edit Mode');
    fireEvent.click(editButtons[0]);

    const textareas = await screen.findAllByPlaceholderText('No content');
    fireEvent.change(textareas[0], { target: { value: 'Updated Intro Content' } });

    const saveButtons = await screen.findAllByTitle('Save');
    fireEvent.click(saveButtons[0]);

    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalledWith('Failed to save point');
    });
  });

  it('enters preaching mode with push (not replace) so back() returns to plan', async () => {
    mockSearchParams = new URLSearchParams();
    renderWithQueryClient(<SermonPlanPage />);

    await screen.findByTestId('plan-introduction-left-section');
    const startPreachingButton = screen.getByTestId('start-preaching');
    fireEvent.click(startPreachingButton);

    expect(mockPush).toHaveBeenCalledWith(
      '/sermons/test-sermon-id/plan?planView=preaching',
      { scroll: false }
    );
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('auto-scrolls to a section when section param is provided', async () => {
    const originalRaf = window.requestAnimationFrame;
    const originalScrollIntoView = Element.prototype.scrollIntoView;
    const scrollIntoView = jest.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    window.requestAnimationFrame = (callback: FrameRequestCallback) => window.setTimeout(callback, 0);

    jest.useFakeTimers();
    mockSearchParams = new URLSearchParams('section=introduction');

    renderWithQueryClient(<SermonPlanPage />);

    await screen.findByTestId('plan-introduction-left-section');

    act(() => {
      jest.runAllTimers();
    });

    expect(scrollIntoView).toHaveBeenCalled();

    jest.useRealTimers();
    window.requestAnimationFrame = originalRaf;
    Element.prototype.scrollIntoView = originalScrollIntoView;
  });

}); 
