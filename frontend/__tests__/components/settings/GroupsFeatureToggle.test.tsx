import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import GroupsFeatureToggle from '@/components/settings/GroupsFeatureToggle';
import { useUserSettings } from '@/hooks/useUserSettings';
import { updateGroupsAccess } from '@/services/userSettings.service';

jest.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ user: { uid: 'test-user-id' } }),
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
    } as any);

    render(<GroupsFeatureToggle />);

    expect(screen.getByTestId('groups-feature-loading')).toBeInTheDocument();
  });

  it('renders disabled toggle from settings', async () => {
    render(<GroupsFeatureToggle />);

    const toggle = await screen.findByRole('switch');
    expect(toggle).not.toBeChecked();
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
