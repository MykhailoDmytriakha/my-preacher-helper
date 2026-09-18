import { act, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';

import UsageWidget from '@/components/settings/UsageWidget';
import { useUserEntitlement } from '@/hooks/useUserEntitlement';

import type { UsageMetricSnapshot, UsageState } from '@/services/usageLimits';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, string | number>) => {
      if (key === 'graceVerses:verses') return ['Verse one', 'Verse two', 'Verse three', 'Verse four'];
      if (key === 'usage.bar.usedOfLimit') return `${values?.used} / ${values?.limit}`;
      if (key === 'usage.bar.percent') return `${values?.pct}%`;
      if (key === 'settings.usage.minutesOfLimit') {
        return `${values?.used} / ${values?.limit} min`;
      }
      if (key === 'usageGrace.hardCap') return `Hard cap ${values?.date}`;
      if (key === 'usageGrace.grace') return `Carried until ${values?.date}`;
      return values?.count ?? values?.tier ?? key;
    },
    i18n: { language: 'en', resolvedLanguage: 'en' },
  }),
}));
jest.mock('@/hooks/useUserEntitlement', () => ({ useUserEntitlement: jest.fn() }));

const mockUseUserEntitlement = useUserEntitlement as jest.MockedFunction<typeof useUserEntitlement>;

const metric = (
  used: number,
  baseLimit: number,
  hardCap: number,
  state: UsageState
): UsageMetricSnapshot => ({
  used,
  baseLimit,
  hardCap,
  baseRemaining: Math.max(0, baseLimit - used),
  graceRemaining: Math.max(0, hardCap - Math.max(baseLimit, used)),
  state,
  resetsAt: '2026-08-01T00:00:00.000Z',
});

const mockEntitlement = (overrides?: {
  ai?: UsageMetricSnapshot;
  transcription?: UsageMetricSnapshot;
  audio?: UsageMetricSnapshot;
}) => {
  const ai = overrides?.ai ?? metric(85, 100, 110, 'warning');
  const transcription = overrides?.transcription ?? metric(90, 3600, 3960, 'normal');
  const audio = overrides?.audio ?? metric(20, 1200, 1320, 'normal');

  mockUseUserEntitlement.mockReturnValue({
    data: {
      effectiveTier: 'free',
      paidTier: 'free',
      functions: {},
      usage: {
        ai,
        transcription,
        audio,
        aiLimit: ai.baseLimit,
        aiUsed: ai.used,
        aiRemaining: ai.baseRemaining,
        transcriptionSecondsLimit: transcription.baseLimit,
        transcriptionSecondsUsed: transcription.used,
        transcriptionSecondsRemaining: transcription.baseRemaining,
        audioSecondsLimit: audio.baseLimit,
        audioSecondsUsed: audio.used,
        audioSecondsRemaining: audio.baseRemaining,
        aiBlocked: ai.state === 'blocked',
        transcriptionBlocked: transcription.state === 'blocked',
        audioBlocked: audio.state === 'blocked',
        periodResets: false,
      },
      limits: {
        aiCallsPerPeriod: ai.baseLimit,
        transcriptionSecondsPerPeriod: transcription.baseLimit,
        audioSecondsPerPeriod: audio.baseLimit,
      },
    },
    isLoading: false,
    isError: false,
  } as unknown as ReturnType<typeof useUserEntitlement>);
};

describe('UsageWidget', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('renders three usage bars with count/minute values on the left and percentages on the right', () => {
    mockEntitlement();

    render(<UsageWidget user={{ uid: 'user-1' } as never} />);

    expect(screen.getByText('settings.usage.aiUsage')).toBeInTheDocument();
    expect(screen.getByText('settings.usage.speechRecognition')).toBeInTheDocument();
    expect(screen.getByText('settings.usage.audio')).toBeInTheDocument();
    expect(screen.getAllByRole('progressbar')).toHaveLength(3);
    expect(screen.getByText('85 / 100')).toBeInTheDocument();
    expect(screen.getByText('2 / 60 min')).toBeInTheDocument();
    expect(screen.getByText('<1 / 20 min')).toBeInTheDocument();
    expect(screen.getByText('85%')).toBeInTheDocument();
    expect(screen.getByText('3%')).toBeInTheDocument();
    expect(screen.getByText('2%')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'settings.usage.aiInfoLabel' })).not.toHaveAttribute('title');
  });

  it('rounds grace usage humanely and uses the overage gradient', () => {
    mockEntitlement({ audio: metric(1250, 1200, 1320, 'grace') });

    render(<UsageWidget user={{ uid: 'user-1' } as never} />);

    expect(screen.getByText('21 / 20 min')).toBeInTheDocument();
    expect(screen.getByText('104%')).toBeInTheDocument();
    const fills = screen.getAllByTestId('usage-bar-fill');
    expect(fills[2]).toHaveClass(
      'bg-gradient-to-r',
      'from-violet-600',
      'to-fuchsia-600',
      'dark:from-violet-500',
      'dark:to-fuchsia-500'
    );
  });

  it('mirrors the warm hard-cap message when any usage resource is blocked', () => {
    mockEntitlement({ ai: metric(110, 100, 110, 'blocked') });

    render(<UsageWidget user={{ uid: 'user-1' } as never} />);

    const notice = screen.getByTestId('usage-hard-cap-notice');
    expect(notice).toHaveTextContent('Hard cap Aug 1, 2026');
    expect(notice).toHaveTextContent('usageGrace.softExpansion');
    expect(notice).toHaveClass('from-violet-50', 'to-fuchsia-50');
  });

  it('says the grace out loud while the person is being carried', () => {
    /**
     * The warm words used to wait for the hard cap, so the whole band where the person IS
     * being carried passed in silence: a full bar, a number over a hundred, and nothing
     * saying why anything still worked. F7 asks for grace to be FELT, not merely granted.
     */
    mockEntitlement({ ai: metric(102, 100, 110, 'grace') });

    render(<UsageWidget user={{ uid: 'user-1' } as never} />);

    const notice = screen.getByTestId('usage-grace-notice');
    expect(notice).toHaveTextContent('Carried until Aug 1, 2026');
    expect(notice).toHaveTextContent('Verse');
  });

  it('does not repeat the same verse when the panel is opened again', () => {
    /**
     * Four verses exist. Walking in from the tooltip and reading the line you just read there
     * — or coming back to settings and meeting the same one — makes the grace feel filed
     * rather than said. The showings share one cycle, so each visit moves it on.
     */
    mockEntitlement({ ai: metric(102, 100, 110, 'grace') });

    const first = render(<UsageWidget user={{ uid: 'user-1' } as never} />);
    const firstVerse = screen.getByTestId('usage-grace-notice').textContent;
    first.unmount();

    render(<UsageWidget user={{ uid: 'user-1' } as never} />);
    const secondVerse = screen.getByTestId('usage-grace-notice').textContent;

    expect(firstVerse).toBeTruthy();
    expect(secondVerse).not.toBe(firstVerse);
  });

  it('lets the hard cap speak instead of the grace once it is reached — one notice, the harder one', () => {
    mockEntitlement({ ai: metric(110, 100, 110, 'blocked'), transcription: metric(102, 100, 110, 'grace') });

    render(<UsageWidget user={{ uid: 'user-1' } as never} />);

    expect(screen.getByTestId('usage-hard-cap-notice')).toBeInTheDocument();
    expect(screen.queryByTestId('usage-grace-notice')).not.toBeInTheDocument();
  });

  it('stays quiet while everything is inside its limit', () => {
    mockEntitlement();

    render(<UsageWidget user={{ uid: 'user-1' } as never} />);

    expect(screen.queryByTestId('usage-grace-notice')).not.toBeInTheDocument();
    expect(screen.queryByTestId('usage-hard-cap-notice')).not.toBeInTheDocument();
  });

  it('opens the AI explanation after the hover delay and dismisses it with Escape', () => {
    jest.useFakeTimers();
    mockEntitlement();

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
    mockEntitlement();

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
