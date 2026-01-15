import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';

import '@testing-library/jest-dom';
import { User } from 'firebase/auth';

import { useUserSettings } from '@/hooks/useUserSettings';
import { UserSettings } from '@/models/models';
import UserSettingsSection from '@components/settings/UserSettingsSection';

// --- Mocks --- //

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

// Mock User Settings Hook
jest.mock('@/hooks/useUserSettings', () => ({
  useUserSettings: jest.fn(),
}));

// --- Test Data --- //

const mockUser: User = {
  uid: 'user-123',
  email: 'user@example.com',
  displayName: 'Firebase User',
  // Add other required User properties if needed by the component
  // (based on firebase/auth User type)
  emailVerified: true,
  isAnonymous: false,
  metadata: {},
  providerData: [],
  providerId: 'firebase',
  refreshToken: 'token',
  tenantId: null,
  delete: jest.fn(),
  getIdToken: jest.fn(),
  getIdTokenResult: jest.fn(),
  reload: jest.fn(),
  toJSON: jest.fn(),
} as unknown as User; // Cast to avoid implementing all methods

const mockSettings: UserSettings = {
  id: 'settings-1',
  userId: 'user-123',
  language: 'en',
  isAdmin: false,
  email: 'settings-email@example.com', // Different email to test override
  displayName: 'Settings Display Name', // Different name to test override
};

// --- Test Suite --- //

describe('UserSettingsSection', () => {

  beforeEach(() => {
    jest.clearAllMocks();
    (useUserSettings as jest.Mock).mockReturnValue({
      settings: mockSettings,
      loading: false,
      error: null,
    });
  });

  const renderSection = (user: User | null = mockUser) => {
    return render(<UserSettingsSection user={user} />);
  };

  it('shows loading state initially', () => {
    (useUserSettings as jest.Mock).mockReturnValue({
      settings: null,
      loading: true,
      error: null,
    });
    renderSection();
    expect(screen.getByText(/settings.loadingUserData/i)).toBeInTheDocument();
    // Re-render or wait for useEffect might be needed depending on exact timing
  });

  it('fetches settings and displays user data when user is provided', async () => {
    renderSection();

    // Verify data is displayed after loading
    await waitFor(() => {
      expect(screen.queryByText(/settings.loadingUserData/i)).not.toBeInTheDocument();
    });

    // Check displayed data (prioritizes settings data over user prop data)
    expect(screen.getByText(mockSettings.email!)).toBeInTheDocument(); // Email from settings
    expect(screen.queryByText(mockUser.email!)).not.toBeInTheDocument();
    expect(screen.getByText(mockUser.uid)).toBeInTheDocument();
    expect(screen.getByText(mockSettings.displayName!)).toBeInTheDocument(); // Display name from settings
    expect(screen.queryByText(mockUser.displayName!)).not.toBeInTheDocument();
    expect(screen.getByText(/settings.moreSettingsSoon/i)).toBeInTheDocument();
  });

  it('displays data from user prop if settings lack specific fields', async () => {
     const settingsWithoutEmail: UserSettings = { ...mockSettings, email: undefined };
    (useUserSettings as jest.Mock).mockReturnValue({
      settings: settingsWithoutEmail,
      loading: false,
      error: null,
    });
    renderSection();

    await waitFor(() => { 
      expect(screen.queryByText(/settings.loadingUserData/i)).not.toBeInTheDocument();
    });

    expect(screen.getByText(mockUser.email!)).toBeInTheDocument(); // Fallback to user prop email
  });

   it('displays fallback text if neither settings nor user prop have data', async () => {
     const settingsWithoutDisplayName: UserSettings = { ...mockSettings, displayName: undefined };
     const userWithoutDisplayName: User = { ...mockUser, displayName: null } as unknown as User;
     (useUserSettings as jest.Mock).mockReturnValue({
       settings: settingsWithoutDisplayName,
       loading: false,
       error: null,
     });
     renderSection(userWithoutDisplayName);

     await waitFor(() => { 
       expect(screen.queryByText(/settings.loadingUserData/i)).not.toBeInTheDocument();
     });

     expect(screen.getByText(/settings.noDisplayName/i)).toBeInTheDocument(); 
   });

  it('handles error during settings fetch', async () => {
    const error = new Error('Failed to fetch');
    (useUserSettings as jest.Mock).mockReturnValue({
      settings: null,
      loading: false,
      error,
    });
    renderSection();

    // Should stop loading, but display might depend on error handling (e.g., show user prop data or an error message)
    // Current implementation seems to just stop loading and might show partial data
    await waitFor(() => {
       expect(screen.queryByText(/settings.loadingUserData/i)).not.toBeInTheDocument();
    });
     // Check if fallback data is shown (e.g., user email if settings failed)
     expect(screen.getByText(mockUser.email!)).toBeInTheDocument();

  });

  it('does not fetch settings and shows loading/logged out state if user is null', () => {
    renderSection(null);
    // Check for the appropriate message when logged out/no user
    // The component shows "loading" state if user is null and loading is false initially
    expect(screen.getByText(/settings.loadingUserData/i)).toBeInTheDocument(); 
  });

}); 