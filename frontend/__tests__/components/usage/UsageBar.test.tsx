import { render, screen } from '@testing-library/react';
import React from 'react';

import UsageBar from '@/components/usage/UsageBar';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, number>) => `${key}:${JSON.stringify(values)}`,
  }),
}));

describe('UsageBar', () => {
  it.each([
    ['full and healthy', 100, 100, '100%', 'bg-blue-600'],
    ['low', 20, 100, '20%', 'bg-amber-500'],
    ['empty', 0, 100, '0%', 'bg-rose-500'],
  ])('renders a %s remaining fill with the matching tone', (_label, remaining, limit, width, tone) => {
    render(<UsageBar limit={limit} remaining={remaining} />);

    const bar = screen.getByRole('progressbar');
    const fill = screen.getByTestId('usage-bar-fill');
    expect(bar).toHaveAttribute('aria-valuenow', width.slice(0, -1));
    expect(fill).toHaveStyle({ width });
    expect(fill).toHaveClass(tone);
  });

  it('keeps an over-limit admin counter visually and verbally empty', () => {
    render(<UsageBar limit={100} remaining={-5} size="compact" />);

    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '0');
    expect(screen.getByTestId('usage-bar-fill')).toHaveStyle({ width: '0%' });
    expect(screen.getByText('usage.bar.remainingOfLimit:{"remaining":0,"limit":100}')).toBeInTheDocument();
  });
});
