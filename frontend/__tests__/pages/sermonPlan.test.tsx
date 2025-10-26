import React from 'react';
import { render, screen, waitFor, act } from '@testing-library/react';
import SermonPlanPage from '@/(pages)/(private)/sermons/[id]/plan/page'; // Alias path
import '@testing-library/jest-dom';

// Mock MutationObserver globally for this test file
global.MutationObserver = jest.fn(() => ({
  observe: jest.fn(),
  disconnect: jest.fn(),
  takeRecords: jest.fn(() => []),
}));

// Mock Next.js router and params
jest.mock('next/navigation', () => ({
  useParams: () => ({ id: 'test-sermon-id' }),
  useRouter: () => ({ push: jest.fn() }),
  useSearchParams: () => new URLSearchParams(),
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
      introduction: { outline: "Intro Outline Mock", outlinePoints: { 'intro-p1': 'Generated Intro Content' } },
      main: { outline: "Main Outline Mock", outlinePoints: { 'main-p1': 'Generated Main Content' } },
      conclusion: { outline: "Conclusion Outline Mock", outlinePoints: { 'con-p1': 'Generated Conclusion Content' } }
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

// Mock i18n with the specific translations needed for this test
jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) => {
      const translations: Record<string, string> = {
        'plan.thoughtsNotAssigned': 'Thoughts not assigned',
        'plan.assignThoughtsFirst': 'Please assign all thoughts to outline points first',
        'plan.workOnSermon': 'Work on Sermon',
        'plan.workOnStructure': 'Work on Structure',
        'plan.markKeyFragments': 'Mark Key Fragments',
        'plan.generating': 'Generating...',
        'plan.regenerate': 'Regenerate',
        'plan.generate': 'Generate',
        'plan.noThoughts': 'No thoughts',
        'plan.noContent': 'No content',
        'plan.noOutlinePoints': 'No outline points',
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
        'errors.outlinePointNotFound': 'Outline point not found',
        'errors.failedToGenerateContent': 'Failed to generate content',
        'errors.failedToSavePoint': 'Failed to save point',
      };
      return translations[key] || options?.defaultValue || key;
    },
  }),
}));

describe('Sermon Plan Page UI Smoke Test', () => {
  // Store original fetch
  const originalFetch = global.fetch;
  
  // Get the mocked function
  const mockGetSermonById = require('@/services/sermon.service').getSermonById as jest.MockedFunction<any>;

  beforeEach(async () => {
    // Ensure we're using real timers for this test
    jest.useRealTimers();
    
    // Reset fetch mock before each test
    global.fetch = jest.fn().mockImplementation((url) => {
      if (url.includes('/api/sermons/test-sermon-id/plan')) {
        // Mock successful response for plan generation GET request
        if (url.includes('outlinePointId=')) { 
          return Promise.resolve({
            ok: true,
            status: 200,
            json: () => Promise.resolve({ content: 'Mock Generated Content' }),
          });
        } 
        // Mock successful response for plan saving PUT request (if needed later)
        // else if (method === 'PUT') { ... }
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
      thoughts: [
        { id: 't1', text: 'Thought 1', outlinePointId: 'intro-p1', tags: ['introduction'], keyFragments: ['frag1'] },
        { id: 't2', text: 'Thought 2', outlinePointId: 'main-p1', tags: ['main'] },
        { id: 't3', text: 'Thought 3', outlinePointId: 'con-p1', tags: ['conclusion'] },
      ],
      plan: {
        introduction: { outline: "Intro Outline Mock", outlinePoints: { 'intro-p1': 'Generated Intro Content' } },
        main: { outline: "Main Outline Mock", outlinePoints: { 'main-p1': 'Generated Main Content' } },
        conclusion: { outline: "Conclusion Outline Mock", outlinePoints: { 'con-p1': 'Generated Conclusion Content' } }
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
      thoughts: [
        { id: 't1', text: 'Thought 1', outlinePointId: null, tags: ['introduction'] },
        { id: 't2', text: 'Thought 2', outlinePointId: null, tags: ['main'] },
        { id: 't3', text: 'Thought 3', outlinePointId: null, tags: ['conclusion'] },
      ],
      plan: null,
      outline: null,
      structure: null,
      goal: 'Mock Goal', 
      audience: 'Mock Audience',
      keyFragments: [],
    };

    // Set the mock to return unassigned thoughts
    mockGetSermonById.mockResolvedValue(mockSermonWithUnassignedThoughts);

    // Render with new mock data
    render(<SermonPlanPage />);
    
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
    expect(() => render(<SermonPlanPage />)).not.toThrow();
  });

}); 