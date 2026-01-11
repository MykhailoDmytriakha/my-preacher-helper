import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import '@testing-library/jest-dom';
import ThemeModeToggle from '@/components/navigation/ThemeModeToggle';
import { useThemePreference } from '@/hooks/useThemePreference';

jest.mock('@/hooks/useThemePreference', () => ({
  useThemePreference: jest.fn(),
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

jest.mock('@locales/i18n', () => {}, { virtual: true });

const mockUseThemePreference = useThemePreference as jest.MockedFunction<typeof useThemePreference>;

describe('ThemeModeToggle', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders full variant and toggles theme', async () => {
    const user = userEvent.setup();
    const setPreference = jest.fn();
    mockUseThemePreference.mockReturnValue({ preference: 'system', setPreference } as any);

    render(<ThemeModeToggle />);

    await waitFor(() => expect(screen.getByText('settings.appearance.themeMode')).toBeInTheDocument());
    expect(screen.getAllByText('settings.appearance.system').length).toBeGreaterThan(0);

    await user.click(screen.getByRole('button', { name: 'settings.appearance.dark' }));
    expect(setPreference).toHaveBeenCalledWith('dark');
  });

  it('renders compact variant with group label', () => {
    mockUseThemePreference.mockReturnValue({ preference: 'light', setPreference: jest.fn() } as any);

    render(<ThemeModeToggle variant="compact" />);

    expect(screen.getByRole('group', { name: /Theme mode|settings\.appearance\.themeMode/ })).toBeInTheDocument();
  });

  it('falls back to system label when preference is unknown', async () => {
    mockUseThemePreference.mockReturnValue({ preference: 'unknown', setPreference: jest.fn() } as any);

    render(<ThemeModeToggle />);

    await waitFor(() => expect(screen.getAllByText('settings.appearance.system').length).toBeGreaterThan(0));
  });
});
