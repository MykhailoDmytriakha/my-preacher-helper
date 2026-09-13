import { render, screen, within } from '@testing-library/react';
import React from 'react';

import UsageBar from '@/components/usage/UsageBar';

import type { UsageState } from '@/services/usageLimits';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, number>) => `${key}:${JSON.stringify(values)}`,
  }),
}));

/**
 * A HUNDRED PERCENT HAS TO BE A PLACE YOU CAN SEE.
 *
 * Two earlier shapes hid it. Spanning the hard cap left grey room to the right of someone
 * already over — headroom beside a number reading 102%. Clamping at the limit filled the bar
 * solid, honest about being full and silent about being PAST. The track now spans what was
 * used: the allowance in the state's colour up to a mark labelled 100%, the excess beyond it
 * in a lighter shade of the same colour — set apart by weight, never by red, because that
 * stretch is the part being carried.
 */
describe('UsageBar', () => {
  it.each([
    ['normal', 40, 100, 'normal', '40%', 'bg-blue-600'],
    ['warning', 80, 100, 'warning', '80%', 'bg-amber-500'],
  ])('fills to the used share while still inside, in the %s tone', (
    _label,
    used,
    baseLimit,
    state,
    width,
    tone
  ) => {
    render(<UsageBar baseLimit={baseLimit} state={state as UsageState} used={used} />);

    const fill = screen.getByTestId('usage-bar-fill');
    expect(fill).toHaveStyle({ width });
    expect(fill).toHaveClass(tone);
    expect(screen.queryByTestId('usage-bar-overage')).not.toBeInTheDocument();
    expect(screen.queryByTestId('usage-bar-limit-mark')).not.toBeInTheDocument();
  });

  it('splits the track at the limit once it is passed, and names the line 100%', () => {
    // 100 of the 125 used is the allowance, so the mark stands four fifths along the track.
    render(<UsageBar baseLimit={100} state="grace" used={125} />);

    expect(screen.getByTestId('usage-bar-fill')).toHaveStyle({ width: '80%' });
    expect(screen.getByTestId('usage-bar-fill')).toHaveClass('from-violet-600');
    expect(screen.getByTestId('usage-bar-overage')).toHaveStyle({ width: '20%' });
    expect(screen.getByTestId('usage-bar-limit-mark')).toHaveStyle({ left: '80%' });
    expect(screen.getByTestId('usage-bar-limit-caption')).toHaveTextContent('usage.bar.percent:{"pct":100}');
    expect(screen.getByText('usage.bar.percent:{"pct":125}')).toBeInTheDocument();
  });

  it('marks the excess by weight, not by alarm — no red past the line', () => {
    render(<UsageBar baseLimit={100} state="grace" used={102} />);

    const overage = screen.getByTestId('usage-bar-overage');
    expect(overage).toHaveClass('bg-fuchsia-300');
    expect(overage.className).not.toMatch(/rose|red/);
    // Squeezed against the right edge the caption tucks in on the used side of the mark,
    // so the words stay on the track instead of hanging off it.
    expect(screen.getByTestId('usage-bar-limit-caption')).toHaveStyle({ transform: 'translateX(-100%)' });
  });

  it('exactly at the limit is full and unsplit — nothing has been exceeded yet', () => {
    render(<UsageBar baseLimit={100} state="grace" used={100} />);

    expect(screen.getByTestId('usage-bar-fill')).toHaveStyle({ width: '100%' });
    expect(screen.queryByTestId('usage-bar-overage')).not.toBeInTheDocument();
    expect(screen.queryByTestId('usage-bar-limit-mark')).not.toBeInTheDocument();
    expect(screen.queryByTestId('usage-bar-limit-caption')).not.toBeInTheDocument();
  });

  it('places the used value on the left and the base percentage on the right', () => {
    render(<UsageBar baseLimit={100} state="grace" used={105} />);

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
        state="normal"
        used={20}
        valueLabel="&lt;1 / 20 min"
      />
    );

    expect(screen.getByText('<1 / 20 min')).toBeInTheDocument();
    expect(screen.getByText('usage.bar.percent:{"pct":2}')).toBeInTheDocument();
  });
});
