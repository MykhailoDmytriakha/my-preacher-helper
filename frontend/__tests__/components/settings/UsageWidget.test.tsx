import { act, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';

import UsageWidget from '@/components/settings/UsageWidget';
import { useUserEntitlement } from '@/hooks/useUserEntitlement';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, string | number>) => values?.count ?? values?.tier ?? key,
  }),
}));
jest.mock('@/hooks/useUserEntitlement', () => ({ useUserEntitlement: jest.fn() }));

const mockUseUserEntitlement = useUserEntitlement as jest.MockedFunction<typeof useUserEntitlement>;

describe('UsageWidget', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('shows the tier and remaining usage with an accessible AI explanation', () => {
    mockUseUserEntitlement.mockReturnValue({
      data: {
        effectiveTier: 'tier2',
        availableModels: [], preferred: {}, paidTier: 'tier2',
        usage: {
          aiLimit: 1000,
          aiUsed: 982,
          aiRemaining: 18,
          transcriptionSecondsLimit: 3600,
          transcriptionSecondsUsed: 0,
          transcriptionSecondsRemaining: 3600,
          audioSecondsUsed: 125.5,
          aiBlocked: false,
          transcriptionBlocked: false,
          periodResets: false,
        },
        limits: { aiCallsPerPeriod: 1000, transcriptionSecondsPerPeriod: 36000 },
      }, isLoading: false, isError: false,
    } as unknown as ReturnType<typeof useUserEntitlement>);

    render(<UsageWidget user={{ uid: 'user-1' } as never} />);

    expect(screen.getByText('2')).toBeInTheDocument();
    expect(screen.getByText('18')).toBeInTheDocument();
    expect(screen.getByText('3600')).toBeInTheDocument();
    expect(screen.getByText('125.5')).toBeInTheDocument();
    const bars = screen.getAllByTestId('usage-bar-fill');
    expect(bars).toHaveLength(2);
    expect(bars[0]).toHaveStyle({ width: '2%' });
    expect(bars[0]).toHaveClass('bg-amber-500', 'dark:bg-amber-400');
    expect(bars[1]).toHaveStyle({ width: '100%' });
    expect(bars[1]).toHaveClass('bg-blue-600', 'dark:bg-blue-400');
    expect(screen.getByRole('button', { name: 'settings.usage.aiInfoLabel' })).not.toHaveAttribute('title');
  });

  it('opens the AI explanation after the hover delay and dismisses it with Escape', () => {
    jest.useFakeTimers();
    mockUseUserEntitlement.mockReturnValue({
      data: {
        effectiveTier: 'free', paidTier: 'free',
        usage: { aiLimit: 10, aiUsed: 0, aiRemaining: 10, transcriptionSecondsLimit: 3600, transcriptionSecondsUsed: 0, transcriptionSecondsRemaining: 3600, audioSecondsUsed: 0, aiBlocked: false, transcriptionBlocked: false, periodResets: false },
        limits: { aiCallsPerPeriod: 10, transcriptionSecondsPerPeriod: 3600 },
      }, isLoading: false, isError: false,
    } as unknown as ReturnType<typeof useUserEntitlement>);

    render(<UsageWidget user={{ uid: 'user-1' } as never} />);

    const button = screen.getByRole('button', { name: 'settings.usage.aiInfoLabel' });
    fireEvent.pointerEnter(button);
    act(() => jest.advanceTimersByTime(499));
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();

    act(() => jest.advanceTimersByTime(1));
    const tooltip = screen.getByRole('tooltip');
    expect(tooltip).toHaveTextContent('settings.usage.aiInfo');
    expect(button).toHaveAttribute('aria-describedby', tooltip.id);

    fireEvent.keyDown(button, { key: 'Escape' });
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });

  it('toggles the AI explanation on click and dismisses it on click-away', () => {
    mockUseUserEntitlement.mockReturnValue({
      data: {
        effectiveTier: 'free', paidTier: 'free',
        usage: { aiLimit: 10, aiUsed: 0, aiRemaining: 10, transcriptionSecondsLimit: 3600, transcriptionSecondsUsed: 0, transcriptionSecondsRemaining: 3600, audioSecondsUsed: 0, aiBlocked: false, transcriptionBlocked: false, periodResets: false },
        limits: { aiCallsPerPeriod: 10, transcriptionSecondsPerPeriod: 3600 },
      }, isLoading: false, isError: false,
    } as unknown as ReturnType<typeof useUserEntitlement>);

    render(<UsageWidget user={{ uid: 'user-1' } as never} />);

    fireEvent.click(screen.getByRole('button', { name: 'settings.usage.aiInfoLabel' }));
    expect(screen.getByRole('tooltip')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'settings.usage.aiInfoLabel' }));
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'settings.usage.aiInfoLabel' }));
    expect(screen.getByRole('tooltip')).toBeInTheDocument();
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });
});
