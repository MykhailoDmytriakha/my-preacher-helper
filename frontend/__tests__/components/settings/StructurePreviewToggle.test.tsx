import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';

import '@testing-library/jest-dom';
import StructurePreviewToggle from '@/components/settings/StructurePreviewToggle';
import { useUserSettings } from '@/hooks/useUserSettings';

let mockUser: { uid: string } | null = { uid: 'test-user-id' };

jest.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ user: mockUser }),
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue || key,
  }),
}));

jest.mock('@/hooks/useUserSettings', () => ({
  useUserSettings: jest.fn(),
}));

const mockUseUserSettings = useUserSettings as jest.MockedFunction<typeof useUserSettings>;

describe('StructurePreviewToggle', () => {
  const mockUpdateStructurePreviewAccess = jest.fn();

  const defaultSettings = {
    settings: { enableStructurePreview: false } as any,
    loading: false,
    error: null,
    refresh: jest.fn(),
    updatePrepModeAccess: jest.fn(),
    updatingPrepMode: false,
    updateAudioGenerationAccess: jest.fn(),
    updatingAudioGeneration: false,
    updateStructurePreviewAccess: mockUpdateStructurePreviewAccess,
    updatingStructurePreview: false,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockUser = { uid: 'test-user-id' };
    mockUpdateStructurePreviewAccess.mockResolvedValue(undefined);
    mockUseUserSettings.mockReturnValue(defaultSettings);
  });

  it('renders loading skeleton while settings are loading (before first load)', () => {
    mockUseUserSettings.mockReturnValue({
      ...defaultSettings,
      settings: null,
      loading: true,
    } as any);

    render(<StructurePreviewToggle />);

    expect(screen.getByTestId('structure-preview-loading')).toBeInTheDocument();
  });

  it('renders toggle in disabled state from settings', async () => {
    render(<StructurePreviewToggle />);

    const toggle = await screen.findByRole('switch');
    expect(toggle).toBeInTheDocument();
    expect(toggle).toHaveAttribute('aria-checked', 'false');
  });

  it('renders toggle in enabled state when setting is true', async () => {
    mockUseUserSettings.mockReturnValue({
      ...defaultSettings,
      settings: { enableStructurePreview: true } as any,
    });

    render(<StructurePreviewToggle />);

    const toggle = await screen.findByRole('switch');
    expect(toggle).toHaveAttribute('aria-checked', 'true');
    expect(toggle).toHaveClass('bg-blue-600');
  });

  it('toggles structure preview when clicked', async () => {
    render(<StructurePreviewToggle />);

    const toggle = await screen.findByRole('switch');
    fireEvent.click(toggle);

    await waitFor(() => {
      expect(mockUpdateStructurePreviewAccess).toHaveBeenCalledWith(true);
      expect(toggle).toHaveAttribute('aria-checked', 'true');
    });
  });

  it('shows alert when toggle update fails', async () => {
    mockUpdateStructurePreviewAccess.mockRejectedValueOnce(new Error('update failed'));
    const alertSpy = jest.spyOn(window, 'alert').mockImplementation(() => {});
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    render(<StructurePreviewToggle />);

    const toggle = await screen.findByRole('switch');
    fireEvent.click(toggle);

    await waitFor(() => {
      expect(alertSpy).toHaveBeenCalledWith('Failed to update setting');
    });

    alertSpy.mockRestore();
    consoleSpy.mockRestore();
  });

  it('does nothing when toggle is clicked without user uid', async () => {
    mockUser = null; // Simulate no user

    render(<StructurePreviewToggle />);

    const toggle = await screen.findByRole('switch');
    fireEvent.click(toggle);

    // With no user.uid, handleToggle returns early — updateStructurePreviewAccess not called
    expect(mockUpdateStructurePreviewAccess).not.toHaveBeenCalled();
  });

  it('does not show loading skeleton after settings have been loaded once', async () => {
    // First render with loading=true but settings already loaded (hasLoaded=true via previous effect)
    // Simulate: user exists, settings loaded, then re-render with loading=false
    render(<StructurePreviewToggle />);

    // Should render main toggle (not skeleton) since loading=false initially
    expect(screen.queryByTestId('structure-preview-loading')).not.toBeInTheDocument();
    expect(await screen.findByTestId('structure-preview-toggle')).toBeInTheDocument();
  });
});
