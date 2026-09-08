import { render, screen } from '@testing-library/react';

import DevQuickNav from '@/components/navigation/DevQuickNav';

const originalFlag = process.env.NEXT_PUBLIC_ENABLE_DEV_NAV;
afterAll(() => {
  if (originalFlag === undefined) delete process.env.NEXT_PUBLIC_ENABLE_DEV_NAV;
  else process.env.NEXT_PUBLIC_ENABLE_DEV_NAV = originalFlag;
});

it('does not render when the development navigation flag is off', () => {
  process.env.NEXT_PUBLIC_ENABLE_DEV_NAV = '0';
  render(<DevQuickNav />);
  expect(screen.queryByText(/Dev Quick Nav/i)).not.toBeInTheDocument();
});

it('renders local development links when the flag is on', () => {
  process.env.NEXT_PUBLIC_ENABLE_DEV_NAV = '1';
  render(<DevQuickNav />);
  expect(screen.getByText(/Dev Quick Nav/i)).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Dashboard' })).toHaveAttribute('href', '/dashboard');
  expect(screen.getByRole('link', { name: 'Settings' })).toHaveAttribute('href', '/settings');
});
