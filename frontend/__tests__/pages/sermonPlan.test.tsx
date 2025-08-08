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
}));

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

// Mock i18n
jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue || key,
  }),
}));

describe('Sermon Plan Page UI Smoke Test', () => {
  // Store original fetch
  const originalFetch = global.fetch;

  beforeEach(async () => {
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

    // Use act for initial render if needed, though usually not required for simple render
    render(<SermonPlanPage />);
  });

  afterEach(() => {
    // Restore original fetch after each test
    global.fetch = originalFetch;
    jest.clearAllMocks(); // Clear other mocks too
  });

  it('renders the main plan page container', async () => {
    // Use findBy* which includes waitFor implicitly
    const container = await screen.findByTestId('sermon-plan-page-container');
    expect(container).toBeInTheDocument();
  });

  // Add checks for save/edit buttons if they exist at the page level
}); 