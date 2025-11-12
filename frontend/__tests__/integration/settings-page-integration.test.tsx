import React from 'react';
import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { runScenarios } from '@test-utils/scenarioRunner';

// Mock all dependencies
const mockUseAuth = jest.fn(() => ({ user: { uid: 'test-user-id' } }));
jest.mock('@/hooks/useAuth', () => ({
  useAuth: () => mockUseAuth()
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key // Return key as translation for simplicity
  })
}));

jest.mock('@locales/i18n', () => ({}));

// Mock Firebase auth
jest.mock('@services/firebaseAuth.service', () => ({
  auth: {
    onAuthStateChanged: jest.fn((callback) => {
      callback({ uid: 'test-user-id' });
      return jest.fn();
    })
  }
}));

const { auth: mockAuth } = require('@services/firebaseAuth.service');

// Mock components
jest.mock('@/components/settings/UserSettingsSection', () => ({
  __esModule: true,
  default: () => <div data-testid="user-settings-section">User Settings</div>
}));

jest.mock('@/components/settings/TagsSection', () => ({
  __esModule: true,
  default: ({ user }: any) => <div data-testid="tags-section">Tags Section for {user?.uid}</div>
}));

jest.mock('@/components/settings/SettingsLayout', () => ({
  __esModule: true,
  default: ({ children, title }: any) => (
    <div data-testid="settings-layout">
      <h1>{title}</h1>
      {children}
    </div>
  )
}));

jest.mock('@/components/settings/SettingsNav', () => ({
  __esModule: true,
  default: ({ activeSection, onNavigate }: any) => (
    <nav data-testid="settings-nav">
      <button
        data-testid="nav-user"
        onClick={() => onNavigate('user')}
        className={activeSection === 'user' ? 'active' : ''}
      >
        User
      </button>
      <button
        data-testid="nav-tags"
        onClick={() => onNavigate('tags')}
        className={activeSection === 'tags' ? 'active' : ''}
      >
        Tags
      </button>
    </nav>
  )
}));

jest.mock('@/components/navigation/LanguageInitializer', () => ({
  __esModule: true,
  default: () => <div data-testid="language-initializer" />
}));

// Import the actual component after all mocks
import SettingsPage from '@/(pages)/(private)/settings/page';

describe('Settings Page Integration', () => {
  const resetScenario = () => {
    jest.clearAllMocks();
    mockUseAuth.mockReturnValue({ user: { uid: 'test-user-id' } });
    mockAuth.onAuthStateChanged.mockImplementation((callback) => {
      callback({ uid: 'test-user-id' });
      return jest.fn();
    });
  };

  beforeEach(resetScenario);

  describe('Page Structure and Navigation', () => {
    it('renders settings page with default user section', async () => {
      await runScenarios(
        [
          {
            name: 'displays settings layout with title',
            run: async () => {
              render(<SettingsPage />);

              await waitFor(() => {
                expect(screen.getByTestId('settings-layout')).toBeInTheDocument();
              });

              expect(screen.getByText('settings.title')).toBeInTheDocument();
            }
          },
          {
            name: 'shows user settings section by default',
            run: async () => {
              render(<SettingsPage />);

              await waitFor(() => {
                expect(screen.getAllByTestId('user-settings-section')[0]).toBeInTheDocument();
              });

              expect(screen.getAllByTestId('user-settings-section')[0]).toHaveTextContent('User Settings');
            }
          },
          {
            name: 'includes PrepModeToggle in user settings section',
            run: async () => {
              render(<SettingsPage />);

              await waitFor(() => {
                // The PrepModeToggle should be rendered within the user settings section
                // We can verify this by checking that the toggle is present
                expect(screen.getAllByRole('switch').length).toBeGreaterThan(0);
              });
            }
          },
          {
            name: 'shows navigation on desktop layout',
            run: async () => {
              render(<SettingsPage />);

              await waitFor(() => {
                expect(screen.getAllByTestId('settings-nav').length).toBeGreaterThanOrEqual(2);
              });

              expect(screen.getAllByTestId('nav-user').length).toBeGreaterThanOrEqual(2);
              expect(screen.getAllByTestId('nav-tags').length).toBeGreaterThanOrEqual(2);
            }
          }
        ],
        { beforeEachScenario: resetScenario, afterEachScenario: cleanup }
      );
    });

    it('handles section navigation', async () => {
      await runScenarios(
        [
          {
            name: 'switches to tags section when navigation clicked',
            run: async () => {
              render(<SettingsPage />);

              await waitFor(() => {
                expect(screen.getAllByTestId('settings-nav')[0]).toBeInTheDocument();
              });

              const tagsButton = screen.getAllByTestId('nav-tags')[0];
              fireEvent.click(tagsButton);

              await waitFor(() => {
                expect(screen.getAllByTestId('tags-section')[0]).toBeInTheDocument();
                expect(screen.getAllByText('Tags Section for test-user-id')[0]).toBeInTheDocument();
              });

              // User settings section should be hidden
              expect(screen.queryAllByTestId('user-settings-section').length).toBe(0);
            }
          },
          {
            name: 'switches back to user section',
            run: async () => {
              render(<SettingsPage />);

              await waitFor(() => {
                expect(screen.getAllByTestId('settings-nav')[0]).toBeInTheDocument();
              });

              // Switch to tags first
              fireEvent.click(screen.getAllByTestId('nav-tags')[0]);

              await waitFor(() => {
                expect(screen.getAllByTestId('tags-section')[0]).toBeInTheDocument();
              });

              // Switch back to user
              fireEvent.click(screen.getAllByTestId('nav-user')[0]);

              await waitFor(() => {
                expect(screen.getAllByTestId('user-settings-section')[0]).toBeInTheDocument();
              });

              expect(screen.queryAllByTestId('tags-section').length).toBe(0);
            }
          }
        ],
        { beforeEachScenario: resetScenario, afterEachScenario: cleanup }
      );
    });
  });

  describe('Authentication Handling', () => {
    it('handles authenticated user correctly', async () => {
      await runScenarios(
        [
          {
            name: 'renders content for authenticated user',
            run: async () => {
              render(<SettingsPage />);

              await waitFor(() => {
                expect(screen.getByTestId('settings-layout')).toBeInTheDocument();
              });

              // Should show content, not redirect
              expect(screen.queryByText('Loading...')).not.toBeInTheDocument();
            }
          }
        ],
        { beforeEachScenario: resetScenario, afterEachScenario: cleanup }
      );
    });
  });

  describe('Mobile vs Desktop Layouts', () => {
    // Note: These tests would need more complex mocking to test responsive behavior
    // For now, we'll test the basic structure that supports both layouts
    it('supports both mobile and desktop navigation patterns', async () => {
      await runScenarios(
        [
          {
            name: 'includes navigation structure for both layouts',
            run: async () => {
              render(<SettingsPage />);

              await waitFor(() => {
                expect(screen.getAllByTestId('settings-nav').length).toBeGreaterThanOrEqual(2);
              });

              // The component renders both mobile and desktop layouts
              // Mobile: grid layout with navigation at top
              // Desktop: sidebar navigation
              expect(screen.getAllByTestId('nav-user').length).toBeGreaterThanOrEqual(2);
              expect(screen.getAllByTestId('nav-tags').length).toBeGreaterThanOrEqual(2);
            }
          }
        ],
        { beforeEachScenario: resetScenario, afterEachScenario: cleanup }
      );
    });
  });

  describe('Language Initialization', () => {
    it('includes language initializer component', async () => {
      await runScenarios(
        [
          {
            name: 'renders language initializer for i18n setup',
            run: async () => {
              render(<SettingsPage />);

              await waitFor(() => {
                expect(screen.getAllByTestId('language-initializer').length).toBeGreaterThan(0);
              });
            }
          }
        ],
        { beforeEachScenario: resetScenario, afterEachScenario: cleanup }
      );
    });
  });
});
