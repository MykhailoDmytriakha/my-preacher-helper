import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';

import '@testing-library/jest-dom';
import { User } from 'firebase/auth';

import { UserSettings } from '@/models/models';
import { getUserSettings } from '@/services/userSettings.service';
import UserSettingsSection from '@components/settings/UserSettingsSection';

// --- Mocks --- //

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

// Mock User Settings Service
jest.mock('@/services/userSettings.service', () => ({
  getUserSettings: jest.fn(),
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
    // Default mock success
    (getUserSettings as jest.Mock).mockResolvedValue(mockSettings);
  });

  const renderSection = (user: User | null = mockUser) => {
    return render(<UserSettingsSection user={user} />);
  };

  it('shows loading state initially', () => {
    // Prevent immediate resolution of the mock
    (getUserSettings as jest.Mock).mockImplementation(() => new Promise(() => {})); 
    renderSection();
    expect(screen.getByText(/settings.loadingUserData/i)).toBeInTheDocument();
    // Re-render or wait for useEffect might be needed depending on exact timing
  });

  it('fetches settings and displays user data when user is provided', async () => {
    renderSection();

    // Should show loading initially, then fetch
    expect(screen.getByText(/settings.loadingUserData/i)).toBeInTheDocument(); 

    await waitFor(() => {
      expect(getUserSettings).toHaveBeenCalledWith(mockUser.uid);
    });

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
    (getUserSettings as jest.Mock).mockResolvedValue(settingsWithoutEmail);
    renderSection();

    await waitFor(() => {
        expect(getUserSettings).toHaveBeenCalled();
    });
    await waitFor(() => { 
      expect(screen.queryByText(/settings.loadingUserData/i)).not.toBeInTheDocument();
    });

    expect(screen.getByText(mockUser.email!)).toBeInTheDocument(); // Fallback to user prop email
  });

   it('displays fallback text if neither settings nor user prop have data', async () => {
     const settingsWithoutDisplayName: UserSettings = { ...mockSettings, displayName: undefined };
     const userWithoutDisplayName: User = { ...mockUser, displayName: null } as unknown as User;
     (getUserSettings as jest.Mock).mockResolvedValue(settingsWithoutDisplayName);
     renderSection(userWithoutDisplayName);

     await waitFor(() => { 
         expect(getUserSettings).toHaveBeenCalled();
     });
     await waitFor(() => { 
       expect(screen.queryByText(/settings.loadingUserData/i)).not.toBeInTheDocument();
     });

     expect(screen.getByText(/settings.noDisplayName/i)).toBeInTheDocument(); 
   });

  it('handles error during settings fetch', async () => {
    const error = new Error('Failed to fetch');
    (getUserSettings as jest.Mock).mockRejectedValue(error);
    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {}); // Suppress console error

    renderSection();

    await waitFor(() => {
      expect(getUserSettings).toHaveBeenCalledWith(mockUser.uid);
    });

    // Should stop loading, but display might depend on error handling (e.g., show user prop data or an error message)
    // Current implementation seems to just stop loading and might show partial data
    await waitFor(() => {
       expect(screen.queryByText(/settings.loadingUserData/i)).not.toBeInTheDocument();
    });
     // Check that the error was logged
     expect(consoleErrorSpy).toHaveBeenCalledWith('Error fetching user settings:', error);
     // Check if fallback data is shown (e.g., user email if settings failed)
     expect(screen.getByText(mockUser.email!)).toBeInTheDocument();

     consoleErrorSpy.mockRestore();
  });

  it('does not fetch settings and shows loading/logged out state if user is null', () => {
    renderSection(null);
    expect(getUserSettings).not.toHaveBeenCalled();
    // Check for the appropriate message when logged out/no user
    // The component shows "loading" state if user is null and loading is false initially
    expect(screen.getByText(/settings.loadingUserData/i)).toBeInTheDocument(); 
  });

}); 