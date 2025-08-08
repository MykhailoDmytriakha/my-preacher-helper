import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import SettingsPage from '@/(pages)/(private)/settings/page'; // Assuming correct path alias
import '@testing-library/jest-dom';

// Mock hooks
jest.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({
    user: { uid: 'test-user', email: 'test@example.com', displayName: 'Test User' },
    loading: false,
  }),
}));

// Mock child components
jest.mock('@/components/settings/UserSettingsSection', () => () => <div data-testid="user-settings-section">Mocked User Settings</div>);
jest.mock('@/components/settings/TagsSection', () => () => <div data-testid="tags-section">Mocked Tags Section</div>);
jest.mock('@/components/settings/SettingsLayout', () => ({ children, title }: { children: React.ReactNode, title: string }) => (
  <div data-testid="settings-layout">
    <h1 role="heading" aria-level={1}>{title}</h1>
    {children}
  </div>
));
jest.mock('@/components/settings/SettingsNav', () => ({ activeSection, onNavigate }: any) => (
  <nav data-testid="settings-nav">
    <button onClick={() => onNavigate('user')} className={activeSection === 'user' ? 'active' : ''}>settings.userSettings</button>
    <button onClick={() => onNavigate('tags')} className={activeSection === 'tags' ? 'active' : ''}>settings.manageTags</button>
  </nav>
));

// Mock i18n
jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key, // Simple mock returns the key
  }),
}));

describe('Settings Page UI Smoke Test', () => {
  beforeEach(() => {
    // Clear mocks before each test if necessary
    // jest.clearAllMocks(); 
    render(<SettingsPage />);
  });

  it('renders the main settings page container', async () => {
    // Wait for the main container to appear (using role="main" added to the component)
    await waitFor(() => {
      const container = screen.getByRole('main');
      expect(container).toBeInTheDocument();
    });
  });

  it('renders the main settings heading', async () => {
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /settings.title/i })).toBeInTheDocument();
    });
  });

  it('renders the Settings Navigation area', async () => {
    // Wait specifically for the nav container(s)
    await waitFor(() => {
      const navs = screen.getAllByTestId('settings-nav');
      expect(navs.length).toBeGreaterThan(0);
    });
    // Then wait specifically for the text within the container(s)
    // Reverting back to getAllByText().length to handle multiple instances
    await waitFor(() => {
      expect(screen.getAllByText(/settings.userSettings/i).length).toBeGreaterThan(0);
      expect(screen.getAllByText(/settings.manageTags/i).length).toBeGreaterThan(0);
    });
  });

  it('renders the User Settings section area', async () => {
    await waitFor(() => {
      // Find all sections and check if at least one exists
      const sections = screen.getAllByTestId('user-settings-section');
      expect(sections.length).toBeGreaterThan(0);
    });
  });

  // it('renders the Tags Section area', () => {
  //   // This might require changing the activeSection state first via interaction
  //   // For a basic smoke test, we'll skip checking the initially hidden section
  //   // expect(screen.getByTestId('tags-section')).toBeInTheDocument(); 
  // });
}); 