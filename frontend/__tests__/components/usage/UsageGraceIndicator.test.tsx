import { fireEvent, render, screen } from '@testing-library/react';
import React from 'react';

import {
  UsageGraceController,
  UsageGraceIndicator,
} from '@/components/usage/UsageGraceIndicator';
import { useUserEntitlement } from '@/hooks/useUserEntitlement';

import type { UsageMetricSnapshot, UsageState } from '@/services/usageLimits';
import type { User } from 'firebase/auth';

jest.mock('sonner', () => ({
  toast: Object.assign(jest.fn(), { error: jest.fn() }),
}));
jest.mock('@/hooks/useUserEntitlement', () => ({ useUserEntitlement: jest.fn() }));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) => {
      if (key === 'graceVerses:verses') return ['Verse one', 'Verse two', 'Verse three', 'Verse four'];
      if (key === 'usageGrace.remainingCount') return `${values?.count} left`;
      if (key === 'usageGrace.remainingMinutes') return `${values?.value} min left`;
      if (key === 'usageGrace.overLimit') return 'Over limit';
      if (key === 'usageGrace.limitReached') return 'Limit reached';
      if (key === 'usageGrace.openSettings') return 'Open plan settings';
      if (key === 'usageGrace.resetsAt') return `renews ${values?.date}`;
      return key;
    },
    i18n: { language: 'en', resolvedLanguage: 'en' },
  }),
}));

const mockedUseUserEntitlement = useUserEntitlement as jest.MockedFunction<typeof useUserEntitlement>;

const metric = (
  used: number,
  baseLimit: number,
  hardCap: number,
  state: UsageState,
  resetsAt = '2026-08-01T00:00:00.000Z'
): UsageMetricSnapshot => ({
  used,
  baseLimit,
  hardCap,
  baseRemaining: Math.max(0, baseLimit - used),
  graceRemaining: Math.max(0, hardCap - Math.max(baseLimit, used)),
  state,
  resetsAt,
});

const entitlement = (ai: UsageMetricSnapshot) => ({
  effectiveTier: 'free',
  paidTier: 'free',
  functions: {},
  limits: {
    aiCallsPerPeriod: 100,
    transcriptionSecondsPerPeriod: 3600,
    audioSecondsPerPeriod: 1200,
  },
  usage: {
    ai,
    transcription: metric(60, 3600, 3960, 'normal'),
    audio: metric(30, 1200, 1320, 'normal'),
  },
});

const user = {
  uid: 'user-1',
  getIdToken: jest.fn().mockResolvedValue('token'),
} as unknown as User;

const renderController = () => render(
  <UsageGraceController user={user}>
    {(model) => (
      <>
        <UsageGraceIndicator model={model} placement="desktop" />
        <UsageGraceIndicator model={model} placement="mobile" />
      </>
    )}
  </UsageGraceController>
);

describe('UsageGraceIndicator', () => {
  beforeEach(() => {
    localStorage.clear();
    jest.clearAllMocks();
  });

  it('keeps both passive points hidden below 80%', () => {
    mockedUseUserEntitlement.mockReturnValue({
      data: entitlement(metric(79, 100, 110, 'normal')),
    } as unknown as ReturnType<typeof useUserEntitlement>);

    renderController();

    expect(screen.queryByTestId('usage-grace-indicator-desktop')).not.toBeInTheDocument();
    expect(screen.queryByTestId('usage-grace-indicator-mobile')).not.toBeInTheDocument();
  });

  it('renders both points from one controller using max utilization and truthful tooltip data', () => {
    mockedUseUserEntitlement.mockReturnValue({
      data: entitlement(metric(85, 100, 110, 'warning')),
    } as unknown as ReturnType<typeof useUserEntitlement>);

    renderController();

    expect(screen.getByTestId('usage-grace-dot-desktop')).toHaveClass('bg-amber-500', 'dark:bg-amber-400');
    expect(screen.getByTestId('usage-grace-dot-mobile')).toHaveClass('bg-amber-500', 'dark:bg-amber-400');
    expect(mockedUseUserEntitlement).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByTestId('usage-grace-indicator-desktop'));
    expect(screen.getByRole('tooltip')).toHaveTextContent('usageGrace.metrics.ai');
    expect(screen.getByRole('tooltip')).toHaveTextContent('15 left');
    expect(screen.getByRole('tooltip')).toHaveTextContent('usageGrace.metrics.transcription');
    expect(screen.getByRole('tooltip')).toHaveTextContent('usageGrace.metrics.audio');
    expect(screen.getByRole('tooltip')).toHaveTextContent('renews Aug 1, 2026');
  });

  it('past the limit, stops counting and says the line was crossed', () => {
    /**
     * At 102 of 100 the tooltip said "8 left" — the remainder of the GRACE band, printed in
     * the ordinary words for an allowance. Beside a bar reading 102% it says the opposite of
     * the truth. Neither does the honest version of that number belong here: "covered for 8
     * more" is read as budget too. Past the line the row says WHERE he stands, and the verse
     * beneath it says why anything still works.
     */
    mockedUseUserEntitlement.mockReturnValue({
      data: entitlement(metric(102, 100, 110, 'grace')),
    } as unknown as ReturnType<typeof useUserEntitlement>);

    renderController();
    fireEvent.click(screen.getByTestId('usage-grace-indicator-desktop'));

    const tooltip = screen.getByRole('tooltip');
    expect(tooltip).toHaveTextContent('Over limit');
    expect(tooltip).not.toHaveTextContent('8 left');
    expect(tooltip).not.toHaveTextContent('102');
    expect(tooltip).not.toHaveTextContent('8 more');
  });

  it('offers the way to the plan settings from the tooltip once the line is crossed', () => {
    /**
     * Being told one is over the limit with nothing to do about it is a dead end. The link is
     * the one action that belongs here — and it appears only past the line: below it there is
     * nothing to act on, and a standing invitation to upgrade would be a sales pitch.
     */
    mockedUseUserEntitlement.mockReturnValue({
      data: entitlement(metric(102, 100, 110, 'grace')),
    } as unknown as ReturnType<typeof useUserEntitlement>);

    renderController();
    fireEvent.click(screen.getByTestId('usage-grace-indicator-desktop'));

    expect(screen.getByTestId('usage-grace-settings-desktop')).toHaveAttribute('href', '/settings/limits');
  });

  it('keeps the tooltip free of the settings link while still inside the limit', () => {
    mockedUseUserEntitlement.mockReturnValue({
      data: entitlement(metric(88, 100, 110, 'warning')),
    } as unknown as ReturnType<typeof useUserEntitlement>);

    renderController();
    fireEvent.click(screen.getByTestId('usage-grace-indicator-desktop'));

    expect(screen.getByRole('tooltip')).toHaveTextContent('12 left');
    expect(screen.queryByTestId('usage-grace-settings-desktop')).not.toBeInTheDocument();
  });

  it('exactly on the line says the limit is reached, not that something is left', () => {
    /**
     * 100 of 100 is the same trap in miniature: nothing of one's own remains, the bar reads
     * 100%, and the GRACE remainder printed as "10 left" contradicts both.
     */
    mockedUseUserEntitlement.mockReturnValue({
      data: entitlement(metric(100, 100, 110, 'grace')),
    } as unknown as ReturnType<typeof useUserEntitlement>);

    renderController();
    fireEvent.click(screen.getByTestId('usage-grace-indicator-desktop'));

    const tooltip = screen.getByRole('tooltip');
    expect(tooltip).toHaveTextContent('Limit reached');
    expect(tooltip).not.toHaveTextContent('10 left');
  });

  it('carries a verse in the tooltip once the line is crossed, and a different one each time', () => {
    /**
     * Four verses exist and the month showed one of them, everywhere, all month. The grace is
     * meant to be felt rather than filed, and a line you have already read stops being read.
     * Each opening takes the next verse in the cycle, so all four come round before any repeats.
     */
    mockedUseUserEntitlement.mockReturnValue({
      data: entitlement(metric(102, 100, 110, 'grace')),
    } as unknown as ReturnType<typeof useUserEntitlement>);

    renderController();
    const indicator = screen.getByTestId('usage-grace-indicator-desktop');

    fireEvent.pointerEnter(indicator);
    fireEvent.click(indicator);
    const first = screen.getByTestId('usage-grace-verse-desktop').textContent;
    expect(first).toMatch(/^Verse /);

    fireEvent.click(indicator);
    fireEvent.pointerEnter(indicator);
    fireEvent.click(indicator);
    const second = screen.getByTestId('usage-grace-verse-desktop').textContent;

    expect(second).toMatch(/^Verse /);
    expect(second).not.toBe(first);
  });

  it('stays silent about grace while still inside the limit', () => {
    // A verse about being carried, shown to someone at 85%, invents a deficit F7 forbids.
    mockedUseUserEntitlement.mockReturnValue({
      data: entitlement(metric(85, 100, 110, 'warning')),
    } as unknown as ReturnType<typeof useUserEntitlement>);

    renderController();
    fireEvent.click(screen.getByTestId('usage-grace-indicator-desktop'));

    expect(screen.queryByTestId('usage-grace-verse-desktop')).not.toBeInTheDocument();
  });

  it.each(['grace', 'blocked'] as const)('uses violet to fuchsia for %s', (state) => {
    mockedUseUserEntitlement.mockReturnValue({
      data: entitlement(metric(state === 'grace' ? 105 : 110, 100, 110, state)),
    } as unknown as ReturnType<typeof useUserEntitlement>);

    renderController();

    expect(screen.getByTestId('usage-grace-dot-desktop')).toHaveClass(
      'bg-gradient-to-r',
      'from-violet-600',
      'to-fuchsia-600',
      'dark:from-violet-500',
      'dark:to-fuchsia-500'
    );
  });

  it('does not count initial grace hydration and deduplicates later enteredGrace by uid+period', () => {
    const sonnerToast = (jest.requireMock('sonner') as { toast: jest.Mock }).toast;
    let current = entitlement(metric(105, 100, 110, 'grace'));
    mockedUseUserEntitlement.mockImplementation(() => ({
      data: current,
    } as unknown as ReturnType<typeof useUserEntitlement>));

    const initial = renderController();
    expect(sonnerToast).not.toHaveBeenCalled();
    initial.unmount();

    current = entitlement(metric(85, 100, 110, 'warning'));
    const transition = renderController();
    current = entitlement(metric(105, 100, 110, 'grace'));
    transition.rerender(
      <UsageGraceController user={user}>
        {(model) => <UsageGraceIndicator model={model} placement="desktop" />}
      </UsageGraceController>
    );
    expect(sonnerToast).toHaveBeenCalledTimes(1);
    expect(sonnerToast).toHaveBeenCalledWith('usageGrace.graceToast', expect.objectContaining({
      id: 'usage-grace:user-1:2026-08-01T00:00:00.000Z:any-resource',
    }));

    current = entitlement(metric(85, 100, 110, 'warning'));
    transition.rerender(
      <UsageGraceController user={user}>
        {(model) => <UsageGraceIndicator model={model} placement="desktop" />}
      </UsageGraceController>
    );
    current = entitlement(metric(105, 100, 110, 'grace'));
    transition.rerender(
      <UsageGraceController user={user}>
        {(model) => <UsageGraceIndicator model={model} placement="desktop" />}
      </UsageGraceController>
    );
    expect(sonnerToast).toHaveBeenCalledTimes(1);
  });

  it('preserves the last state through a transient empty entitlement snapshot', () => {
    const sonnerToast = (jest.requireMock('sonner') as { toast: jest.Mock }).toast;
    let current = entitlement(metric(85, 100, 110, 'warning')) as ReturnType<typeof entitlement> | undefined;
    mockedUseUserEntitlement.mockImplementation(() => ({
      data: current,
    } as unknown as ReturnType<typeof useUserEntitlement>));

    const view = renderController();
    current = undefined;
    view.rerender(
      <UsageGraceController user={user}>
        {(model) => <UsageGraceIndicator model={model} placement="desktop" />}
      </UsageGraceController>
    );

    current = entitlement(metric(105, 100, 110, 'grace'));
    view.rerender(
      <UsageGraceController user={user}>
        {(model) => <UsageGraceIndicator model={model} placement="desktop" />}
      </UsageGraceController>
    );

    expect(sonnerToast).toHaveBeenCalledTimes(1);
    expect(sonnerToast).toHaveBeenCalledWith('usageGrace.graceToast', expect.any(Object));
  });
});
