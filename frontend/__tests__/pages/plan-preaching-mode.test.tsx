// Simple integration test for PreachingTimer component in plan context
import { render, screen } from '@testing-library/react';
import React from 'react';

import PreachingTimer from '../../app/components/PreachingTimer';

// Mock the usePreachingTimer hook
jest.mock('@hooks/usePreachingTimer', () => ({
  usePreachingTimer: jest.fn(),
}));

const mockUsePreachingTimer = require('@hooks/usePreachingTimer').usePreachingTimer;

describe('PreachingTimer - Plan Integration', () => {
  const mockTimerData = {
    timerState: {
      timeRemaining: 1200,
      currentPhase: 'introduction' as const,
      status: 'idle' as const,
      isRunning: false,
      isPaused: false,
      isFinished: false,
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
    },
    settings: {
      totalDuration: 1200,
      introductionRatio: 0.2,
      mainRatio: 0.8,
      conclusionRatio: 0.0,
      updateSettings: jest.fn(),
    },
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockUsePreachingTimer.mockReturnValue(mockTimerData);
  });

  it('renders correctly in plan context', () => {
    render(<PreachingTimer initialDuration={1200} className="plan-timer" />);

    expect(screen.getAllByRole('timer')).toHaveLength(3); // Component has multiple timer elements
    expect(screen.getByRole('region', { name: /plan.timer.regionLabel/i })).toBeInTheDocument();

    // Verify hook integration
    expect(mockUsePreachingTimer).toHaveBeenCalledWith({
      totalDuration: 1200,
    }, {
      onFinish: undefined,
    });
  });

  it('integrates with plan styling', () => {
    render(<PreachingTimer initialDuration={900} className="plan-preaching-timer" />);

    const timerContainer = screen.getByRole('region').closest('.plan-preaching-timer');
    expect(timerContainer).toBeInTheDocument();
  });

  it('handles different durations for plan phases', () => {
    mockUsePreachingTimer.mockReturnValue({
      ...mockTimerData,
      timerState: { ...mockTimerData.timerState, timeRemaining: 1800 },
      visualState: { ...mockTimerData.visualState, displayTime: '30:00' },
      settings: { ...mockTimerData.settings, totalDuration: 1800 },
    });

    render(<PreachingTimer initialDuration={1800} />);

    expect(screen.getAllByRole('timer')).toHaveLength(3);
    expect(mockUsePreachingTimer).toHaveBeenCalledWith({
      totalDuration: 1800,
    }, {
      onFinish: undefined,
    });
  });
});
