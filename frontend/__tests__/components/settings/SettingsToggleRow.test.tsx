import { fireEvent, render, screen } from '@testing-library/react';

import SettingsToggleRow from '@/components/settings/SettingsToggleRow';

const props = {
  title: 'Preparation mode', description: 'Use the preparation workflow',
  enabled: false, onToggle: jest.fn(), loading: false, testId: 'preparation',
};

it('associates each switch with its own title and description', () => {
  render(<><SettingsToggleRow {...props} /><SettingsToggleRow {...props} title="Audio" testId="audio" enabled /></>);
  expect(screen.getByRole('switch', { name: 'Preparation mode' })).not.toBeChecked();
  expect(screen.getByRole('switch', { name: 'Audio' })).toBeChecked();
  expect(screen.getByRole('switch', { name: 'Audio' })).toHaveAccessibleDescription(props.description);
  expect(screen.getByRole('switch', { name: 'Audio' })).toHaveClass('bg-blue-600');
  expect(screen.getByRole('switch', { name: 'Audio' }).firstChild).toHaveClass('translate-x-5');
  expect(screen.getByRole('switch', { name: 'Preparation mode' })).toHaveClass('bg-gray-200');
  expect(screen.getByRole('switch', { name: 'Preparation mode' }).firstChild).toHaveClass('translate-x-0');
});

it('dispatches a click once and prevents interaction while disabled', () => {
  const onToggle = jest.fn();
  const { rerender } = render(<SettingsToggleRow {...props} onToggle={onToggle} />);
  fireEvent.click(screen.getByRole('switch'));
  expect(onToggle).toHaveBeenCalledTimes(1);
  rerender(<SettingsToggleRow {...props} onToggle={onToggle} disabled />);
  fireEvent.click(screen.getByRole('switch'));
  expect(onToggle).toHaveBeenCalledTimes(1);
  expect(screen.getByRole('switch')).toBeDisabled();
});

it('shows a skeleton without an interactive control until loaded', () => {
  const { rerender } = render(<SettingsToggleRow {...props} loading />);
  expect(screen.getByTestId('preparation-loading')).toBeInTheDocument();
  expect(screen.queryByRole('switch')).not.toBeInTheDocument();
  rerender(<SettingsToggleRow {...props} />);
  expect(screen.queryByTestId('preparation-loading')).not.toBeInTheDocument();
  expect(screen.getByRole('switch')).toBeEnabled();
});
