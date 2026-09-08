import { fireEvent, render, screen } from '@testing-library/react';

import DebugModeToggle from '@/components/settings/DebugModeToggle';

const mockSetEnabled = jest.fn();
let mockEnabled = false;
let mockLoaded = false;
jest.mock('@/hooks/useDebugMode', () => ({
  useDebugMode: () => ({ enabled: mockEnabled, setEnabled: mockSetEnabled, hasLoaded: mockLoaded }),
}));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock('@/utils/debugMode', () => ({ debugLog: jest.fn() }));

it('waits for local preferences, then uses the shared switch for both directions', () => {
  const { rerender } = render(<DebugModeToggle />);
  expect(screen.getByTestId('debug-mode-loading')).toBeInTheDocument();
  mockLoaded = true;
  rerender(<DebugModeToggle />);
  expect(screen.getByRole('switch', { name: 'settings.debugMode.title' })).not.toBeChecked();
  fireEvent.click(screen.getByRole('switch'));
  expect(mockSetEnabled).toHaveBeenLastCalledWith(true);
  mockEnabled = true;
  rerender(<DebugModeToggle />);
  fireEvent.click(screen.getByRole('switch'));
  expect(mockSetEnabled).toHaveBeenLastCalledWith(false);
});
