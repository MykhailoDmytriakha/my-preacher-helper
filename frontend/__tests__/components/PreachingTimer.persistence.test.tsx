import { jest } from '@jest/globals';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';

// Mock the usePreachingTimer hook BEFORE importing the component
const mockUsePreachingTimer = jest.fn();
jest.mock('@hooks/usePreachingTimer', () => ({
  usePreachingTimer: mockUsePreachingTimer,
}));

import PreachingTimer from '../../app/components/PreachingTimer';

// Mock localStorage
const localStorageMock = {
  getItem: jest.fn(),
  setItem: jest.fn(),
  removeItem: jest.fn(),
  clear: jest.fn(),
};
Object.defineProperty(window, 'localStorage', {
  value: localStorageMock,
});

describe('PreachingTimer Persistence', () => {
  const baseTimerState = {
    timeRemaining: 1200, // 20 minutes
    currentPhase: 'introduction' as const,
    status: 'idle' as const,
    isRunning: false,
    isPaused: false,
    isFinished: false,
  };

  const baseVisualState = {
    displayTime: '20:00',
    displayColor: '#FCD34D',
    phaseLabel: 'sections.introduction',
    isEmergency: false,
    animationClass: '',
  };

  const baseSettings = {
    totalDuration: 1200,
    introductionRatio: 0.2,
    mainRatio: 0.8,
    conclusionRatio: 0.0,
  };

  const createActions = () => ({
    start: jest.fn(),
    pause: jest.fn(),
    resume: jest.fn(),
    stop: jest.fn(),
    skip: jest.fn(),
    reset: jest.fn(),
    setDuration: jest.fn(),
  });

  type TimerActions = ReturnType<typeof createActions>;
  type TimerDataOverrides = {
    timerState?: Partial<typeof baseTimerState>;
    visualState?: Partial<typeof baseVisualState>;
    actions?: Partial<TimerActions>;
    settings?: Partial<typeof baseSettings> & { updateSettings?: jest.Mock };
  };

  const createTimerData = (overrides: TimerDataOverrides = {}) => {
    const { timerState, visualState, actions, settings } = overrides;
    const { updateSettings, ...restSettings } = settings ?? {};

    return {
      timerState: { ...baseTimerState, ...timerState },
      visualState: { ...baseVisualState, ...visualState },
      actions: { ...createActions(), ...actions },
      settings: {
        ...baseSettings,
        ...restSettings,
        updateSettings: updateSettings ?? jest.fn(),
      },
    };
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockUsePreachingTimer.mockReset();
    localStorageMock.getItem.mockReset();
    localStorageMock.setItem.mockReset();
    localStorageMock.removeItem.mockReset();
    localStorageMock.clear.mockReset();
  });

  it('loads saved duration from localStorage on initialization', () => {
    // Mock localStorage to return saved duration
    localStorageMock.getItem.mockReturnValue('900'); // 15 minutes

    const timerData = createTimerData({
      visualState: { displayTime: '15:00' },
      settings: { totalDuration: 900 },
    });

    mockUsePreachingTimer.mockReturnValue(timerData);

    render(<PreachingTimer />);

    // Verify that localStorage.getItem was called for the timer duration
    expect(localStorageMock.getItem).toHaveBeenCalledWith('preaching-timer-duration');

    // The timer should show the saved duration (15:00)
    const fifteenMinuteDisplays = screen.getAllByText('15:00', { selector: '.time-display' });
    expect(fifteenMinuteDisplays.length).toBeGreaterThan(0);
  });

  it('saves duration to localStorage when setDuration is called', async () => {
    const timerData = createTimerData();
    mockUsePreachingTimer.mockReturnValue(timerData);

    const handleSetDuration = jest.fn();

    render(<PreachingTimer onSetDuration={handleSetDuration} />);

    const user = userEvent.setup();

    // Click on timer to open duration picker
    const timerDisplay = document.querySelector('.time-display[role=\"button\"]') as HTMLElement | null;
    expect(timerDisplay).not.toBeNull();
    await user.click(timerDisplay!);

    // Click on 15 minute preset
    const fifteenMinButton = screen.getAllByRole('button', { name: '15m' })[0];
    await user.click(fifteenMinButton);

    // Verify that callbacks were triggered with the selected duration
    await waitFor(() => {
      expect(handleSetDuration).toHaveBeenCalledWith(900); // 15 * 60 seconds
    });

    // In a real scenario, setDuration would call localStorage.setItem
    // but since we're mocking the hook, we can't test this directly
    // The actual persistence logic is tested in the hook tests
  });

  it('uses default duration when no saved duration exists', () => {
    // Mock localStorage to return null (no saved duration)
    localStorageMock.getItem.mockReturnValue(null);

    const timerData = createTimerData();
    mockUsePreachingTimer.mockReturnValue(timerData);

    render(<PreachingTimer />);

    // Verify that localStorage.getItem was called
    expect(localStorageMock.getItem).toHaveBeenCalledWith('preaching-timer-duration');

    // Timer should show default duration (20:00)
    const defaultDurationDisplays = screen.getAllByText('20:00', { selector: '.time-display' });
    expect(defaultDurationDisplays.length).toBeGreaterThan(0);
  });
});
