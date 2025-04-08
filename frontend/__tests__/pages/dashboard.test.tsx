import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import DashboardPage from '@/(pages)/dashboard/page';
import '@testing-library/jest-dom';

// Mock child components for structural testing
jest.mock('@/components/navigation/DashboardNav', () => () => <div data-testid="dashboard-nav">Mocked Nav</div>);
jest.mock('@/components/dashboard/DashboardStats', () => ({ sermons }: { sermons: any[] }) => <div data-testid="dashboard-stats">Mocked Stats ({sermons.length})</div>);
jest.mock('@/components/dashboard/SermonList', () => ({ sermons, onUpdate, onDelete }: { sermons: any[], onUpdate: any, onDelete: any }) => <div data-testid="sermon-list">Mocked List ({sermons.length})</div>);
jest.mock('@/components/AddSermonModal', () => ({ onCreate }: { onCreate: any }) => <button data-testid="add-sermon-modal-trigger">Mocked Add Sermon</button>); // Mocking the modal trigger

// Mock hooks
jest.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ 
    user: { uid: 'test-user', email: 'test@example.com' },
    loading: false
  }),
}));

// Mock services
jest.mock('@/services/sermon.service', () => ({
  getSermons: jest.fn().mockResolvedValue([
    { id: '1', title: 'Sermon 1', date: '2023-01-01', verse: 'Verse 1', thoughts: [] },
    { id: '2', title: 'Sermon 2', date: '2023-01-08', verse: 'Verse 2', thoughts: [] },
  ]),
  listenToSermons: jest.fn((userId, callback) => {
    // Simulate immediate callback with test data
    callback([
      { id: 'sermon1', title: 'Sermon 1', thoughts: [{id: 't1', text: 'Thought 1'}] },
      { id: 'sermon2', title: 'Sermon 2', thoughts: [] },
    ]);
    // Return mock unsubscribe function
    return jest.fn();
  }),
  deleteSermon: jest.fn().mockResolvedValue(true),
  updateSermon: jest.fn().mockResolvedValue(true),
}));

// Mock i18n
jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key, // Simple mock returns the key
  }),
}));

describe('Dashboard Page UI Smoke Test', () => {
  beforeEach(() => {
    render(<DashboardPage />);
  });

  it('renders the main dashboard content area', async () => {
    // Check for an element that indicates the main page content is loaded,
    // like the main heading specific to this page.
    await waitFor(() => {
      const heading = screen.getByRole('heading', { name: /dashboard.mySermons/i });
      expect(heading).toBeInTheDocument();
    });
  });

  it('renders the main dashboard heading', async () => {
    // Corrected to check for the actual heading text used in the component
    await waitFor(() => expect(screen.getByRole('heading', { name: /dashboard.mySermons/i })).toBeInTheDocument());
  });

  it('renders the DashboardStats component with sermon data', async () => {
    await waitFor(() => {
      const statsComponent = screen.getByTestId('dashboard-stats');
      expect(statsComponent).toBeInTheDocument();
      expect(statsComponent).toHaveTextContent('Mocked Stats (2)'); // 2 sermons from mock data
    });
  });

  it('renders the SermonList component with sermon data', async () => {
    await waitFor(() => {
      const listComponent = screen.getByTestId('sermon-list');
      expect(listComponent).toBeInTheDocument();
      expect(listComponent).toHaveTextContent('Mocked List (2)'); // 2 sermons from mock data
    });
  });

  it('renders the AddSermonModal trigger', async () => { // Renamed test for clarity
    // Checks for the trigger button rendered by the mocked AddSermonModal
    await waitFor(() => expect(screen.getByTestId('add-sermon-modal-trigger')).toBeInTheDocument());
  });
}); 