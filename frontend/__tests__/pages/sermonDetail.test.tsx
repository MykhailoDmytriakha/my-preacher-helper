import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import SermonDetailPage from '@/(pages)/(private)/sermons/[id]/page'; // Assuming correct path alias
import '@testing-library/jest-dom';

// Mock next/navigation to provide route params
jest.mock('next/navigation', () => ({
  useParams: () => ({ id: 'test-sermon-id' }),
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), refresh: jest.fn() }),
  usePathname: jest.fn().mockReturnValue('/'),
  useSearchParams: () => ({ get: () => null, toString: () => '' })
}));

// Mock child components
jest.mock('@/components/sermon/SermonHeader', () => () => <div data-testid="sermon-header">Mocked Sermon Header</div>);
jest.mock('@/components/AddThoughtManual', () => () => <button data-testid="add-thought-manual">Mocked Add Thought</button>);
jest.mock('@/components/Column', () => () => <div data-testid="column">Mocked Column</div>); // Mock columns for structure view
jest.mock('@/components/ThoughtCard', () => () => <div data-testid="thought-card">Mocked Thought Card</div>);
jest.mock('@/components/EditThoughtModal', () => () => <div data-testid="edit-thought-modal">Mocked Edit Modal</div>);

// Mock hooks
jest.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ user: { uid: 'test-user' }, loading: false }),
}));

jest.mock('@/hooks/useSermon', () => ({
  __esModule: true,
  default: jest.fn(() => ({
    sermon: { 
      id: 'test-sermon-id', 
      title: 'Test Sermon',
      thoughts: [
        { id: 'thought1', text: 'Test thought 1', tags: ['tag1'] },
        { id: 'thought2', text: 'Test thought 2', tags: ['tag2'] },
      ]
    },
    loading: false,
    getSortedThoughts: jest.fn(() => [
      { id: 'thought1', text: 'Test thought 1', tags: ['tag1'] },
      { id: 'thought2', text: 'Test thought 2', tags: ['tag2'] },
    ]),
    setSermon: jest.fn(),
    refreshSermon: jest.fn(),
  })),
}));

jest.mock('@/hooks/useEditThought', () => ({
  useEditThought: () => ({
    isEditing: false,
    editingThought: null,
    startEditing: jest.fn(),
    stopEditing: jest.fn(),
    handleSave: jest.fn(),
  }),
}));

// Mock services
jest.mock('@/services/sermon.service', () => ({
  getSermonById: jest.fn().mockResolvedValue({ 
    id: 'test-sermon-id', 
    title: 'Test Sermon',
    thoughts: [{id: 't1', text: 'Thought 1', tags: ['Tag1']}]
  }),
}));

jest.mock('@/services/thought.service', () => ({
  createThought: jest.fn().mockResolvedValue({}),
  updateThought: jest.fn().mockResolvedValue({}),
  deleteThought: jest.fn().mockResolvedValue({}),
}));

// Mock i18n
jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue || key,
  }),
}));

describe('Sermon Detail Page UI Smoke Test', () => {
  beforeEach(() => {
    render(<SermonDetailPage />);
  });

  it('renders the sermon header component', () => {
    expect(screen.getByTestId('sermon-header')).toBeInTheDocument();
  });

  it('renders the add thought button', () => {
    expect(screen.getByTestId('add-thought-manual')).toBeInTheDocument();
  });

  it('renders the thoughts panel or container', () => {
    expect(screen.getByTestId('sermon-thoughts-container')).toBeInTheDocument();
  });

  // If your implementation uses thought cards for displaying thoughts
  it('renders thought cards when sermon has thoughts', () => {
    expect(screen.getAllByTestId('thought-card').length).toBeGreaterThan(0);
  });

  // If your implementation shows thought filtering or sorting controls
  it('renders thought filtering controls', async () => {
    // Find the filter toggle button first
    const filterButton = screen.getByTestId('thought-filter-button'); // Assuming this test id exists on the button
    expect(filterButton).toBeInTheDocument();

    // Click the button to open the dropdown
    fireEvent.click(filterButton);

    // Wait for the dropdown content to appear and check for the controls
    await waitFor(() => {
      expect(screen.getByTestId('thought-filter-controls')).toBeInTheDocument();
    });
  });
}); 