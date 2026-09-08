import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

import GroupsFeatureToggle from '@/components/settings/GroupsFeatureToggle';
import { useUserSettings } from '@/hooks/useUserSettings';
import { updateGroupsAccess } from '@/services/userSettings.service';

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

jest.mock('@/services/userSettings.service', () => ({
  updateGroupsAccess: jest.fn(),
}));

const mockUseUserSettings = useUserSettings as jest.MockedFunction<typeof useUserSettings>;
const mockUpdateGroupsAccess = updateGroupsAccess as jest.MockedFunction<typeof updateGroupsAccess>;

describe('GroupsFeatureToggle', () => {
  const refresh = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    mockUser = { uid: 'test-user-id' };
    refresh.mockResolvedValue(undefined);
    mockUpdateGroupsAccess.mockResolvedValue(undefined);
    mockUseUserSettings.mockReturnValue({
      settings: { enableGroups: false } as any,
      loading: false,
      error: null,
      refresh,
      updatePrepModeAccess: jest.fn(),
      updatingPrepMode: false,
      updateAudioGenerationAccess: jest.fn(),
      updatingAudioGeneration: false,
      updateStructurePreviewAccess: jest.fn(),
      updatingStructurePreview: false,
      updateFirstDayOfWeek: jest.fn(),
      updatingFirstDayOfWeek: false,
      updateShowAppVersion: jest.fn(),
      updatingShowAppVersion: false,
      updateModelPreference: jest.fn(),
      updatingModelPreference: false,
      updateFunctionModelPreference: jest.fn(),
      updatingFunctionModelPreference: false,
    });
  });

  it('renders loading skeleton while settings are loading', () => {
    mockUseUserSettings.mockReturnValue({
      settings: null,
      loading: true,
      error: null,
      refresh,
      updatePrepModeAccess: jest.fn(),
      updatingPrepMode: false,
      updateAudioGenerationAccess: jest.fn(),
      updatingAudioGeneration: false,
      updateStructurePreviewAccess: jest.fn(),
      updatingStructurePreview: false,
      updateFirstDayOfWeek: jest.fn(),
      updatingFirstDayOfWeek: false,
    } as any);

    render(<GroupsFeatureToggle />);

    expect(screen.getByTestId('groups-feature-loading')).toBeInTheDocument();
  });

  it('renders disabled toggle from settings', async () => {
    render(<GroupsFeatureToggle />);

    const toggle = await screen.findByRole('switch');
    expect(toggle).not.toBeChecked();
  });

  it('does not submit without an authenticated owner', () => {
    mockUser = null;
    render(<GroupsFeatureToggle />);
    fireEvent.click(screen.getByRole('switch'));
    expect(mockUpdateGroupsAccess).not.toHaveBeenCalled();
  });

  it('adopts the loaded value and preserves it through a background refresh', () => {
    const initial = mockUseUserSettings('test-user-id');
    mockUseUserSettings.mockReturnValue({ ...initial, settings: { ...initial.settings!, enableGroups: true } });
    const { rerender } = render(<GroupsFeatureToggle />);
    expect(screen.getByRole('switch')).toBeChecked();
    mockUseUserSettings.mockReturnValue({ ...initial, loading: true, settings: null });
    rerender(<GroupsFeatureToggle />);
    expect(screen.getByRole('switch')).toBeChecked();
    mockUseUserSettings.mockReturnValue({ ...initial, settings: null });
    rerender(<GroupsFeatureToggle />);
    expect(screen.getByRole('switch')).not.toBeChecked();
    expect(mockUpdateGroupsAccess).not.toHaveBeenCalled();
  });

  it('locks during persistence and refresh, then announces the confirmed value once', async () => {
    let persist!: () => void;
    let refreshed!: () => void;
    mockUpdateGroupsAccess.mockReturnValueOnce(new Promise<void>(resolve => { persist = resolve; }));
    refresh.mockReturnValueOnce(new Promise<void>(resolve => { refreshed = resolve; }));
    const announced = jest.fn();
    window.addEventListener('groups-feature-updated', announced);
    try {
      render(<GroupsFeatureToggle />);
      fireEvent.click(screen.getByRole('switch'));
      expect(screen.getByRole('switch')).toBeDisabled();
      fireEvent.click(screen.getByRole('switch'));
      expect(mockUpdateGroupsAccess).toHaveBeenCalledTimes(1);
      expect(refresh).not.toHaveBeenCalled();
      await act(async () => { persist(); });
      expect(screen.getByRole('switch')).toBeDisabled();
      expect(announced).not.toHaveBeenCalled();
      await act(async () => { refreshed(); });
      expect(screen.getByRole('switch')).toBeEnabled();
      expect(screen.getByRole('switch')).toBeChecked();
      expect(announced).toHaveBeenCalledTimes(1);
      expect(announced.mock.calls[0][0].detail).toBe(true);
    } finally {
      window.removeEventListener('groups-feature-updated', announced);
    }
  });

  it('toggles groups feature and refreshes settings', async () => {
    render(<GroupsFeatureToggle />);

    const toggle = await screen.findByRole('switch');
    fireEvent.click(toggle);

    await waitFor(() => {
      expect(mockUpdateGroupsAccess).toHaveBeenCalledWith('test-user-id', true);
      expect(refresh).toHaveBeenCalledTimes(1);
      expect(toggle).toHaveAttribute('aria-checked', 'true');
    });
  });

  it('shows alert when toggle update fails', async () => {
    mockUpdateGroupsAccess.mockRejectedValueOnce(new Error('update failed'));
    const alertSpy = jest.spyOn(window, 'alert').mockImplementation(() => { });
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => { });

    render(<GroupsFeatureToggle />);

    const toggle = await screen.findByRole('switch');
    fireEvent.click(toggle);

    await waitFor(() => {
      expect(alertSpy).toHaveBeenCalledWith('Failed to update setting');
      expect(consoleSpy).toHaveBeenCalledWith(
        'GroupsFeatureToggle: Error updating setting:',
        expect.any(Error)
      );
    });

    alertSpy.mockRestore();
    consoleSpy.mockRestore();
  });
});
