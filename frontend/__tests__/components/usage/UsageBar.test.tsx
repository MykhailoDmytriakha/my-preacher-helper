import { render, screen, within } from '@testing-library/react';
import React from 'react';

import UsageBar from '@/components/usage/UsageBar';

import type { UsageState } from '@/services/usageLimits';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, number>) => `${key}:${JSON.stringify(values)}`,
  }),
}));

describe('UsageBar', () => {
  it.each([
    ['normal', 40, 100, 110, 'normal', '36.36363636363637%', 'bg-blue-600'],
    ['warning', 80, 100, 110, 'warning', '72.72727272727273%', 'bg-amber-500'],
    ['grace', 105, 100, 110, 'grace', '95.45454545454545%', 'from-violet-600'],
    ['blocked overage', 115, 100, 110, 'blocked', '100%', 'to-fuchsia-600'],
  ])('renders the %s snapshot with the matching tone', (
    _label,
    used,
    baseLimit,
    hardCap,
    state,
    width,
    tone
  ) => {
    render(
      <UsageBar
        baseLimit={baseLimit}
        hardCap={hardCap}
        state={state as UsageState}
        used={used}
      />
    );

    const fill = screen.getByTestId('usage-bar-fill');
    expect(fill).toHaveStyle({ width });
    expect(fill).toHaveClass(tone);
    expect(screen.getByTestId('usage-bar-base-limit')).toHaveStyle({ left: '90.9090909090909%' });
  });

  it('places the used value on the left and the base percentage on the right', () => {
    render(<UsageBar baseLimit={100} hardCap={110} state="grace" used={105} />);

    const labels = within(screen.getByRole('progressbar')).getByTestId('usage-bar-labels');
    const [value, percentage] = Array.from(labels.children);

    expect(value).toHaveTextContent('usage.bar.usedOfLimit:{"used":105,"limit":100}');
    expect(percentage).toHaveTextContent('usage.bar.percent:{"pct":105}');
    expect(value.compareDocumentPosition(percentage) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('supports a formatted value without changing the raw percentage', () => {
    render(
      <UsageBar
        baseLimit={1200}
        hardCap={1320}
        state="normal"
        used={20}
        valueLabel="&lt;1 / 20 min"
      />
    );

    expect(screen.getByText('<1 / 20 min')).toBeInTheDocument();
    expect(screen.getByText('usage.bar.percent:{"pct":2}')).toBeInTheDocument();
  });
});
