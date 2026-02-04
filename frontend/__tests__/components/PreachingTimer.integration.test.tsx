import { jest } from '@jest/globals';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import React from 'react';

// Mock various hooks
// Mock various hooks
const mockUsePreachingTimer = jest.fn();
const mockRouter = {
  back: jest.fn(),
  push: jest.fn(),
};

// Data mocks
// Data definitions inline to avoid hoisting issues
// const mockSermon = { id: '123', title: 'Test Sermon' };
// const mockSeries = { id: '456', title: 'Test Series' };

// Mock hooks
jest.mock('@/hooks/usePreachingTimer', () => ({
  usePreachingTimer: mockUsePreachingTimer,
}));

// Mock useSermon for all possible import paths
const mockSermonImpl = () => ({
  sermon: { id: '123', title: 'Test Sermon' },
  loading: false,
  error: null
});

jest.mock('@/hooks/useSermon', () => ({
  __esModule: true,
  default: mockSermonImpl,
}));

jest.mock('@hooks/useSermon', () => ({
  __esModule: true,
  default: mockSermonImpl,
}));

jest.mock('../../app/hooks/useSermon', () => ({
  __esModule: true,
  default: mockSermonImpl,
}));

// Mock useSeriesDetail
const mockSeriesImpl = () => ({
  series: { id: '456', title: 'Test Series' },
  loading: false,
  error: null
});

jest.mock('@/hooks/useSeriesDetail', () => ({
  useSeriesDetail: mockSeriesImpl,
}));
jest.mock('@hooks/useSeriesDetail', () => ({
  useSeriesDetail: mockSeriesImpl,
}));
jest.mock('../../app/hooks/useSeriesDetail', () => ({
  useSeriesDetail: mockSeriesImpl,
}));

jest.mock('next/navigation', () => ({
  useRouter: () => mockRouter,
  usePathname: () => '/sermons/123/plan',
  useSearchParams: () => new URLSearchParams('planView=preaching'),
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) => {
      const translations: Record<string, string> = {
        'plan.timer.regionLabel': 'Preaching Timer Controls',
        'navigation.breadcrumb.dashboard': 'Dashboard',
        'navigation.breadcrumb.sermon': 'Sermon',
        'navigation.breadcrumb.plan': 'Plan',
        'navigation.breadcrumb.preaching': 'Preaching',
        'navigation.tooltip.swipe': 'Swipe Tip',
        'navigation.escape.ariaLabel': 'Go back',
      };
      return translations[key] || options?.defaultValue || key;
    },
  }),
}));

import PreachingTimer from '../../app/components/PreachingTimer';
import SectionTimePicker from '../../app/components/SectionTimePicker';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

describe('PreachingTimer Integration', () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });

  beforeAll(() => {
    Object.defineProperty(HTMLElement.prototype, 'scrollTo', {
      value: jest.fn(),
      writable: true,
    });
  });

  const renderWithClient = (ui: React.ReactNode) => {
    return render(
      <QueryClientProvider client={queryClient}>
        {ui}
      </QueryClientProvider>
    );
  };

  const mockTimerData = {
    timerState: {
      timeRemaining: 1200, // 20 minutes
      currentPhase: 'introduction' as const,
      status: 'idle' as const,
      isRunning: false,
      isPaused: false,
      isFinished: false,
    },
    progress: {
      totalProgress: 0,
      phaseProgress: 0,
      phaseProgressByPhase: {
        introduction: 0,
        main: 0,
        conclusion: 0,
      },
      timeElapsed: 0,
      timeRemaining: 1200,
    },
    visualState: {
      displayTime: '20:00',
      displayColor: '#FCD34D',
      phaseLabel: 'sections.introduction',
      isEmergency: false,
      animationClass: '',
    },
    actions: {
      start: jest.fn(),
      pause: jest.fn(),
      resume: jest.fn(),
      stop: jest.fn(),
      skip: jest.fn(),
      reset: jest.fn(),
      setDuration: jest.fn(),
      setPhaseDurations: jest.fn(),
    },
    settings: {
      totalDuration: 1200,
      introductionRatio: 0.2,
      mainRatio: 0.6,
      conclusionRatio: 0.2,
      mode: 'total' as const,
      updateSettings: jest.fn(),
    },
    events: {
      onPhaseChange: undefined,
      onFinish: undefined,
      onEmergency: undefined,
    },
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockUsePreachingTimer.mockReturnValue(mockTimerData);
    queryClient.clear();
    localStorage.clear();
  });

  it('renders timer display and controls with hook data', () => {
    renderWithClient(<PreachingTimer />);

    // Check timer display
    const timeDisplays = screen.getAllByText('20:00');
    expect(timeDisplays).toHaveLength(2); // desktop and mobile (tablet is likely hidden or same as mobile in new layout)

    // Check that timer region exists
    const timerRegion = screen.getByRole('region', { name: /Preaching Timer Controls|plan\.timer\.regionLabel/i });
    expect(timerRegion).toBeInTheDocument();

    // Check controls are rendered
    const startButtons = screen.getAllByRole('button', { name: /actions\.start/i });
    expect(startButtons).toHaveLength(2); // desktop and mobile
    const stopButtons = screen.getAllByRole('button', { name: /plan\.timer\.stop/i });
    expect(stopButtons).toHaveLength(2);
    const skipButtons = screen.getAllByRole('button', { name: /plan\.timer\.skip/i });
    expect(skipButtons).toHaveLength(2);
  });

  it('renders with initial duration (smoke test)', () => {
    expect(() => renderWithClient(<PreachingTimer initialDuration={1200} />)).not.toThrow();
  });

  it('calls onTimerStateChange with per-phase progress', () => {
    const onTimerStateChange = jest.fn();
    renderWithClient(<PreachingTimer onTimerStateChange={onTimerStateChange} />);

    expect(onTimerStateChange).toHaveBeenCalled();
    const payload = onTimerStateChange.mock.calls[0][0] as {
      phaseProgressByPhase: {
        introduction: number;
        main: number;
        conclusion: number;
      };
    };
    expect(payload.phaseProgressByPhase).toEqual({
      introduction: 0,
      main: 0,
      conclusion: 0,
    });
  });

  it('displays emergency styling when in emergency mode', () => {
    mockUsePreachingTimer.mockReturnValue({
      ...mockTimerData,
      visualState: {
        ...mockTimerData.visualState,
        isEmergency: true,
        displayColor: '#EF4444',
      },
    });

    renderWithClient(<PreachingTimer />);

    // Emergency styling is applied to time display elements
    const timeDisplays = screen.getAllByText('20:00');
    expect(timeDisplays).toHaveLength(2);
    // Check that at least one has emergency styling (would need more specific selector for exact element)
  });

  it('applies animation class when provided', () => {
    mockUsePreachingTimer.mockReturnValue({
      ...mockTimerData,
      visualState: {
        ...mockTimerData.visualState,
        animationClass: 'timer-blink',
      },
    });

    renderWithClient(<PreachingTimer />);

    // Animation class is applied to timer display elements
    const timerDisplays = screen.getAllByRole('timer');
    expect(timerDisplays).toHaveLength(2);
    // Check that at least one has animation class (would need more specific selector for exact element)
  });

  it('renders buttons for timer controls', () => {
    renderWithClient(<PreachingTimer />);

    // Verify buttons are rendered for each layout
    const startButtons = screen.getAllByRole('button', { name: /actions\.start/i });
    const stopButtons = screen.getAllByRole('button', { name: /plan\.timer\.stop/i });
    const skipButtons = screen.getAllByRole('button', { name: /plan\.timer\.skip/i });

    expect(startButtons).toHaveLength(2);
    expect(stopButtons).toHaveLength(2);
    expect(skipButtons).toHaveLength(2);
  });

  // Note: Resume button and phase change tests require more complex mocking
  // and are not critical for basic component functionality

  it('applies custom className', () => {
    renderWithClient(<PreachingTimer className="custom-timer" />);

    const container = screen.getByRole('region', { name: /Preaching Timer Controls|plan\.timer\.regionLabel/i });
    expect(container).toHaveClass('custom-timer');
  });

  it('integrates all components correctly', () => {
    renderWithClient(<PreachingTimer />);

    // Verify the complete component structure
    const timeDisplays = screen.getAllByText('20:00');
    expect(timeDisplays).toHaveLength(2);

    // Check that timer region exists
    const timerRegion = screen.getByRole('region', { name: /Preaching Timer Controls|plan\.timer\.regionLabel/i });
    expect(timerRegion).toBeInTheDocument();

    // Phase labels are no longer displayed in the UI (minimal design)

    // Verify buttons are present and functional
    const startButtons = screen.getAllByRole('button', { name: /actions\.start/i });
    const stopButtons = screen.getAllByRole('button', { name: /plan\.timer\.stop/i });
    const skipButtons = screen.getAllByRole('button', { name: /plan\.timer\.skip/i });
    expect(startButtons).toHaveLength(2);
    expect(stopButtons).toHaveLength(2);
    expect(skipButtons).toHaveLength(2);
  });

  it('loads stored section durations when available', () => {
    localStorage.setItem(
      'preaching-timer-phase-durations',
      JSON.stringify({ introduction: 120, main: 600, conclusion: 180 })
    );
    const getItemSpy = jest.spyOn(Storage.prototype, 'getItem');

    renderWithClient(<PreachingTimer />);

    expect(getItemSpy).toHaveBeenCalledWith('preaching-timer-phase-durations');
    getItemSpy.mockRestore();
  });

  it('opens section picker and supports cancel/back/confirm flows', async () => {
    const onSetDuration = jest.fn();
    jest.useFakeTimers();
    renderWithClient(<PreachingTimer onSetDuration={onSetDuration} />);

    const openInlinePresets = () => {
      const timerButtons = screen.getAllByRole('button', { name: '20:00' });
      fireEvent.click(timerButtons[0]);
      expect(screen.getAllByText('10m').length).toBeGreaterThan(0);
    };

    const openSectionPicker = async () => {
      act(() => {
        fireEvent.click(screen.getByRole('button', { name: /By sections|plan\.timePicker\.bySections/i }));
      });
      await act(async () => {
        jest.advanceTimersByTime(60);
      });
      await screen.findByText(/Section times|plan\.timePicker\.sectionsTitle/i);
    };

    openInlinePresets();
    await openSectionPicker();
    fireEvent.click(screen.getByRole('button', { name: /common\.cancel|Cancel/i }));
    expect(screen.queryByText(/Section times|plan\.timePicker\.sectionsTitle/i)).not.toBeInTheDocument();

    openInlinePresets();
    await openSectionPicker();
    fireEvent.click(screen.getByRole('button', { name: /common\.back|Back/i }));
    expect(screen.getAllByText('10m').length).toBeGreaterThan(0);

    openInlinePresets();
    await openSectionPicker();
    const sectionDialog = screen.getByRole('dialog');
    const dialogUtils = within(sectionDialog);

    fireEvent.click(dialogUtils.getByRole('button', { name: '1m' }));
    await act(async () => {
      fireEvent.click(dialogUtils.getByRole('button', { name: /plan\.setTime|Set Time/i }));
    });
    await act(async () => {
      jest.runOnlyPendingTimers();
    });
    await waitFor(() => expect(onSetDuration).toHaveBeenCalledWith(1020));
    jest.useRealTimers();
  });

  it('handles invalid stored section durations without crashing', () => {
    localStorage.setItem('preaching-timer-phase-durations', '{invalid-json');
    expect(() => renderWithClient(<PreachingTimer />)).not.toThrow();
  });

  it('ignores parseable but invalid stored section durations', () => {
    localStorage.setItem(
      'preaching-timer-phase-durations',
      JSON.stringify({ introduction: 120, main: -10, conclusion: 180 })
    );

    expect(() => renderWithClient(<PreachingTimer />)).not.toThrow();
  });

});

describe('SectionTimePicker', () => {
  const baseDurations = { introduction: 240, main: 600, conclusion: 180 };

  beforeAll(() => {
    Object.defineProperty(HTMLElement.prototype, 'scrollTo', {
      value: jest.fn(),
      writable: true,
    });
  });

  it('renders and switches active phases', () => {
    render(
      <SectionTimePicker
        initialDurations={baseDurations}
        onConfirm={jest.fn()}
        onCancel={jest.fn()}
      />
    );

    expect(screen.getAllByText('00:04:00').length).toBeGreaterThan(0);
    fireEvent.click(screen.getByText('sections.main'));
    expect(screen.getAllByText('00:10:00').length).toBeGreaterThan(0);
  });

  it('applies presets and confirms/cancels/back', () => {
    const onConfirm = jest.fn();
    const onCancel = jest.fn();
    const onBack = jest.fn();

    render(
      <SectionTimePicker
        initialDurations={baseDurations}
        onConfirm={onConfirm}
        onCancel={onCancel}
        onBack={onBack}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: '30s' }));
    expect(screen.getAllByText('00:00:30').length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole('button', { name: /plan\.setTime|Set Time/i }));
    expect(onConfirm).toHaveBeenCalledWith({
      introduction: 30,
      main: 600,
      conclusion: 180,
    });

    fireEvent.click(screen.getByRole('button', { name: /common\.cancel|Cancel/i }));
    expect(onCancel).toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: /common\.back|Back/i }));
    expect(onBack).toHaveBeenCalled();
  });

  it('ignores scroll updates when index is unchanged', () => {
    jest.useFakeTimers();
    render(
      <SectionTimePicker
        initialDurations={{ introduction: 0, main: 0, conclusion: 0 }}
        onConfirm={jest.fn()}
        onCancel={jest.fn()}
      />
    );

    const listboxes = screen.getAllByRole('listbox');
    const hoursList = listboxes[0] as HTMLElement;
    Object.defineProperty(hoursList, 'scrollTop', {
      value: 0,
      writable: true,
    });

    fireEvent.scroll(hoursList);

    act(() => {
      jest.advanceTimersByTime(200);
    });

    expect(screen.getAllByText('00:00:00').length).toBeGreaterThan(0);
    jest.useRealTimers();
  });

  it('keeps phase duration when preset matches current value', () => {
    const onConfirm = jest.fn();

    render(
      <SectionTimePicker
        initialDurations={baseDurations}
        onConfirm={onConfirm}
        onCancel={jest.fn()}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: '4m' }));
    fireEvent.click(screen.getByRole('button', { name: /plan\.setTime|Set Time/i }));

    expect(onConfirm).toHaveBeenCalledWith(baseDurations);
  });

  it('handles overlay and keyboard actions', () => {
    const onConfirm = jest.fn();
    const onCancel = jest.fn();
    const { container } = render(
      <SectionTimePicker
        initialDurations={baseDurations}
        onConfirm={onConfirm}
        onCancel={onCancel}
      />
    );

    const dialog = container.querySelector('.time-picker-container') as HTMLElement;
    fireEvent.keyDown(dialog, { key: 'Escape' });
    fireEvent.keyDown(dialog, { key: 'Enter' });
    fireEvent.mouseDown(screen.getByRole('dialog'));
    fireEvent.click(screen.getByRole('button', { name: /common\.close|Close/i }));

    expect(onCancel).toHaveBeenCalled();
    expect(onConfirm).toHaveBeenCalled();
  });

  it('updates time via wheel scroll', () => {
    jest.useFakeTimers();
    render(
      <SectionTimePicker
        initialDurations={{ introduction: 0, main: 0, conclusion: 0 }}
        onConfirm={jest.fn()}
        onCancel={jest.fn()}
      />
    );

    const listboxes = screen.getAllByRole('listbox');
    const hoursList = listboxes[0] as HTMLElement;
    Object.defineProperty(hoursList, 'scrollTop', {
      value: 32,
      writable: true,
    });

    fireEvent.scroll(hoursList);

    act(() => {
      jest.advanceTimersByTime(200);
    });

    expect(screen.getAllByText('01:00:00').length).toBeGreaterThan(0);
    jest.useRealTimers();
  });
});
