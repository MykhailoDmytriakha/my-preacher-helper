import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { jest } from '@jest/globals';
import PlanPage from '../../app/(pages)/(private)/sermons/[id]/plan/page';

// Mock all dependencies
jest.mock('../../app/services/sermon.service', () => ({
  getSermonById: jest.fn(),
}));

// Use the global next/navigation mock from jest.setup.js

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => {
      const translations: Record<string, string> = {
        'sections.introduction': 'Introduction',
        'sections.main': 'Main Part',
        'sections.conclusion': 'Conclusion',
        'plan.noContent': 'No content available',
        'plan.pageTitle': 'Plan',
        'plan.preachButton': 'Preach',
        'plan.timePicker.title': 'Set Timer Duration',
        'plan.timePicker.totalTime': 'Total Time',
        'plan.timePicker.startPreaching': 'Start Preaching',
        'plan.timer.remaining': 'remaining',
        'plan.timer.finished': 'Finished',
        'plan.timer.pause': 'Pause',
        'plan.timer.resume': 'Resume',
        'plan.timer.stop': 'Stop',
        'plan.timer.skip': 'Skip to next phase',
        'plan.exitPreachingMode': 'Exit Preaching Mode',
        'common.scripture': 'Scripture',
      };
      return translations[key] || key;
    },
  }),
}));

// Mock timer components - simplified approach with controlled state
jest.mock('../../app/components/PreachingTimer', () => {
  const React = require('react');

  // Store component instances for testing
  const instances: any[] = [];

  return function MockPreachingTimer({ initialDuration, className }: { initialDuration?: number; className?: string }) {
    const [phase, setPhase] = React.useState<'introduction' | 'main' | 'conclusion' | 'finished'>('introduction');
    const [timeRemaining, setTimeRemaining] = React.useState(initialDuration || 1200);
    const [isRunning, setIsRunning] = React.useState(true);

    // Store instance for external control
    const instanceRef = React.useRef({
      setTime: (time: number) => {
        setTimeRemaining(time);
        if (time <= 300 && time > 0) setPhase('conclusion');
        else if (time <= 900 && time > 300) setPhase('main');
        else if (time === 0) {
          setPhase('finished');
          setIsRunning(false);
        }
      },
      setPhase,
      setRunning: setIsRunning,
      getState: () => ({ phase, timeRemaining, isRunning })
    });

    React.useEffect(() => {
      instances.push(instanceRef.current);
      return () => {
        const index = instances.indexOf(instanceRef.current);
        if (index > -1) instances.splice(index, 1);
      };
    }, []);

    // Global access for tests
    (global as any).__timerInstances = instances;

    const formatTime = (seconds: number): string => {
      const mins = Math.floor(Math.abs(seconds) / 60);
      const secs = Math.abs(seconds) % 60;
      return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    };

    const phaseColors = {
      introduction: '#FCD34D',
      main: '#3B82F6',
      conclusion: '#10B981',
      finished: '#EF4444'
    };

    return (
      <div data-testid="preaching-timer" className={className}>
        <div data-testid="timer-display">
          <span data-testid="phase-label">{phase}</span>
          <span data-testid="time-display" style={{ color: phaseColors[phase] }}>
            {formatTime(timeRemaining)}
          </span>
          <span>remaining</span>
        </div>
        <div data-testid="timer-controls">
          <button
            data-testid="pause-btn"
            onClick={() => setIsRunning(!isRunning)}
            disabled={timeRemaining === 0}
          >
            {isRunning ? 'Pause' : 'Resume'}
          </button>
          <button
            data-testid="stop-btn"
            onClick={() => {
              setIsRunning(false);
              setTimeRemaining(initialDuration || 1200);
              setPhase('introduction');
            }}
          >
            Stop
          </button>
          <button
            data-testid="skip-btn"
            onClick={() => {
              if (phase === 'introduction') setPhase('main');
              else if (phase === 'main') setPhase('conclusion');
            }}
            disabled={phase === 'conclusion' || phase === 'finished'}
          >
            Skip to next phase
          </button>
        </div>
      </div>
    );
  };
});

jest.mock('../../app/components/TimePickerPopup', () => {
  const React = require('react');
  return function MockTimePickerPopup({
    isOpen,
    onClose,
    onStartPreaching,
    initialDuration = 1200
  }: {
    isOpen: boolean;
    onClose: () => void;
    onStartPreaching: (duration: number) => void;
    initialDuration?: number;
  }) {
    const [selectedDuration, setSelectedDuration] = React.useState(initialDuration);

    if (!isOpen) return null;

    return (
      <div data-testid="time-picker-popup" role="dialog">
        <h2>Set Timer Duration</h2>
        <div data-testid="duration-display">
          Total Time: {Math.floor(selectedDuration / 60)}:{(selectedDuration % 60).toString().padStart(2, '0')}
        </div>
        <div data-testid="preset-buttons">
          <button data-testid="15min-btn" onClick={() => setSelectedDuration(900)}>15 min</button>
          <button data-testid="20min-btn" onClick={() => setSelectedDuration(1200)}>20 min</button>
          <button data-testid="25min-btn" onClick={() => setSelectedDuration(1500)}>25 min</button>
          <button data-testid="30min-btn" onClick={() => setSelectedDuration(1800)}>30 min</button>
        </div>
        <div data-testid="time-scrollers">
          <div data-testid="hours-scroller">Hours: {Math.floor(selectedDuration / 3600)}</div>
          <div data-testid="minutes-scroller">Minutes: {Math.floor((selectedDuration % 3600) / 60)}</div>
          <div data-testid="seconds-scroller">Seconds: {selectedDuration % 60}</div>
        </div>
        <button
          data-testid="start-preaching-btn"
          onClick={() => onStartPreaching(selectedDuration)}
        >
          Start Preaching
        </button>
        <button data-testid="close-popup-btn" onClick={onClose}>
          Close
        </button>
      </div>
    );
  };
});

// Mock visual effects
jest.mock('../../app/utils/visualEffects', () => ({
  triggerScreenBlink: jest.fn().mockResolvedValue(undefined),
  triggerTextHighlight: jest.fn().mockResolvedValue(undefined),
  triggerPhaseTransition: jest.fn().mockResolvedValue(undefined),
  triggerEmergencyAlert: jest.fn().mockResolvedValue(undefined),
  triggerSuccessEffect: jest.fn().mockResolvedValue(undefined),
  cancelVisualEffects: jest.fn(),
  areVisualEffectsSupported: jest.fn().mockReturnValue(true),
}));

const mockGetSermonById = require('../../app/services/sermon.service').getSermonById;

// Get references to globally mocked functions
const { useParams, useRouter, useSearchParams, usePathname } = require('next/navigation');

// Create spies to override global mock behavior
const useRouterSpy = jest.spyOn(require('next/navigation'), 'useRouter');
const useSearchParamsSpy = jest.spyOn(require('next/navigation'), 'useSearchParams');
const useParamsSpy = jest.spyOn(require('next/navigation'), 'useParams');
const usePathnameSpy = jest.spyOn(require('next/navigation'), 'usePathname');

const mockTriggerScreenBlink = require('../../app/utils/visualEffects').triggerScreenBlink;
const mockTriggerPhaseTransition = require('../../app/utils/visualEffects').triggerPhaseTransition;

describe.skip('Preaching Timer - End-to-End Workflow', () => {
  const mockSermon = {
    id: 'sermon-1',
    title: 'Test Sermon',
    verse: 'John 3:16',
    outline: {
      introduction: [{ id: 'intro-1', text: 'Introduction Point' }],
      main: [{ id: 'main-1', text: 'Main Point' }],
      conclusion: [{ id: 'conc-1', text: 'Conclusion Point' }],
    },
    thoughts: [
      { id: 'thought-1', text: 'Test thought', outlinePointId: 'intro-1' }
    ],
    plan: {
      introduction: { outline: '# Introduction\n\nWelcome and context' },
      main: { outline: '# Main\n\nCore message content' },
      conclusion: { outline: '# Conclusion\n\nFinal thoughts and call to action' },
    },
  };

  const mockRouter = {
    replace: jest.fn(),
    push: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();

    // Clear timer instances
    if ((global as any).__timerInstances) {
      (global as any).__timerInstances.length = 0;
    }

    // Setup mocks - override global mocks for this test
    useParamsSpy.mockReturnValue({ id: 'sermon-1' });
    useRouterSpy.mockReturnValue(mockRouter);
    usePathnameSpy.mockReturnValue('/sermons/sermon-1/plan');
    mockGetSermonById.mockResolvedValue(mockSermon);
  });

  afterEach(() => {
    jest.useRealTimers();
    // Restore all spies after each test
    useRouterSpy.mockRestore();
    useSearchParamsSpy.mockRestore();
    useParamsSpy.mockRestore();
    usePathnameSpy.mockRestore();
  });

  it('completes full preaching timer workflow from start to finish', async () => {
    // Start with normal plan view
    useSearchParamsSpy.mockReturnValue({
      get: (key: string) => null,
      toString: () => '',
    });

    render(<PlanPage />);

    // Wait for sermon to load
    await waitFor(() => {
      expect(screen.getByText('Test Sermon')).toBeInTheDocument();
    });

    // Click preach button to open time picker
    const preachButton = screen.getByText('Preach');
    fireEvent.click(preachButton);

    // Time picker should open
    await waitFor(() => {
      expect(screen.getByTestId('time-picker-popup')).toBeInTheDocument();
    });

    // Select 15 minute preset
    const fifteenMinBtn = screen.getByTestId('15min-btn');
    fireEvent.click(fifteenMinBtn);

    // Start preaching
    const startBtn = screen.getByTestId('start-preaching-btn');
    fireEvent.click(startBtn);

    // Should transition to preaching mode
    await waitFor(() => {
      expect(screen.getByTestId('preaching-timer')).toBeInTheDocument();
    });

    // Check initial timer state
    expect(screen.getByTestId('phase-label')).toHaveTextContent('introduction');
    expect(screen.getByTestId('time-display')).toHaveTextContent('15:00');

    // Advance timer to trigger phase change to main (15min - 5min = 10min = 600sec)
    act(() => {
      const timerInstance = (global as any).__timerInstances?.[0];
      timerInstance?.setTime(600);
    });

    await waitFor(() => {
      expect(screen.getByTestId('phase-label')).toHaveTextContent('main');
      expect(mockTriggerPhaseTransition).toHaveBeenCalled();
    });

    // Advance timer to trigger phase change to conclusion (10min - 10min = 0min = 0sec)
    act(() => {
      const timerInstance = (global as any).__timerInstances?.[0];
      timerInstance?.setTime(0);
    });

    await waitFor(() => {
      expect(screen.getByTestId('phase-label')).toHaveTextContent('finished');
      expect(mockTriggerScreenBlink).toHaveBeenCalled();
    });
  });

  it('handles timer controls correctly during preaching', async () => {
    // Start directly in preaching mode
    useSearchParamsSpy.mockReturnValue({
      get: (key: string) => key === 'planView' ? 'preaching' : null,
      toString: () => 'planView=preaching',
    });

    render(<PlanPage />);

    await waitFor(() => {
      expect(screen.getByTestId('preaching-timer')).toBeInTheDocument();
    });

    // Initial state - timer should be running
    expect(screen.getByTestId('pause-btn')).toHaveTextContent('Pause');

    // Pause timer
    fireEvent.click(screen.getByTestId('pause-btn'));
    expect(screen.getByTestId('pause-btn')).toHaveTextContent('Resume');

    // Resume timer
    fireEvent.click(screen.getByTestId('pause-btn'));
    expect(screen.getByTestId('pause-btn')).toHaveTextContent('Pause');

    // Skip to next phase
    fireEvent.click(screen.getByTestId('skip-btn'));
    expect(screen.getByTestId('phase-label')).toHaveTextContent('main');

    // Stop timer
    fireEvent.click(screen.getByTestId('stop-btn'));
    expect(screen.getByTestId('phase-label')).toHaveTextContent('introduction');
    expect(screen.getByTestId('time-display')).toHaveTextContent('20:00'); // Reset to initial
  });

  it('allows exiting preaching mode', async () => {
    useSearchParamsSpy.mockReturnValue({
      get: (key: string) => key === 'planView' ? 'preaching' : null,
      toString: () => 'planView=preaching',
    });

    render(<PlanPage />);

    await waitFor(() => {
      expect(screen.getByTestId('preaching-timer')).toBeInTheDocument();
    });

    // Click exit button
    const exitButton = screen.getByText('Exit Preaching Mode');
    fireEvent.click(exitButton);

    // Should navigate away from preaching mode
    expect(mockRouter.replace).toHaveBeenCalledWith('/sermons/sermon-1/plan', { scroll: false });
  });

  it('displays sermon content correctly in preaching mode', async () => {
    useSearchParamsSpy.mockReturnValue({
      get: (key: string) => key === 'planView' ? 'preaching' : null,
      toString: () => 'planView=preaching',
    });

    render(<PlanPage />);

    await waitFor(() => {
      expect(screen.getByTestId('preaching-timer')).toBeInTheDocument();
    });

    // Check sermon verse
    expect(screen.getByText('John 3:16')).toBeInTheDocument();

    // Check plan sections
    expect(screen.getByText('Introduction')).toBeInTheDocument();
    expect(screen.getByText('Welcome and context')).toBeInTheDocument();

    expect(screen.getByText('Main Part')).toBeInTheDocument();
    expect(screen.getByText('Core message content')).toBeInTheDocument();

    expect(screen.getByText('Conclusion')).toBeInTheDocument();
    expect(screen.getByText('Final thoughts and call to action')).toBeInTheDocument();
  });

  it('handles time picker interactions correctly', async () => {
    useSearchParamsSpy.mockReturnValue({
      get: (key: string) => null,
      toString: () => '',
    });

    render(<PlanPage />);

    await waitFor(() => {
      expect(screen.getByText('Test Sermon')).toBeInTheDocument();
    });

    // Open time picker
    const preachButton = screen.getByText('Preach');
    fireEvent.click(preachButton);

    await waitFor(() => {
      expect(screen.getByTestId('time-picker-popup')).toBeInTheDocument();
    });

    // Test preset buttons
    const twentyMinBtn = screen.getByTestId('20min-btn');
    fireEvent.click(twentyMinBtn);
    expect(screen.getByTestId('duration-display')).toHaveTextContent('Total Time: 20:00');

    // Close popup
    const closeBtn = screen.getByTestId('close-popup-btn');
    fireEvent.click(closeBtn);

    expect(screen.queryByTestId('time-picker-popup')).not.toBeInTheDocument();
  });

  it('maintains accessibility throughout workflow', async () => {
    useSearchParamsSpy.mockReturnValue({
      get: (key: string) => key === 'planView' ? 'preaching' : null,
      toString: () => 'planView=preaching',
    });

    render(<PlanPage />);

    await waitFor(() => {
      expect(screen.getByTestId('preaching-timer')).toBeInTheDocument();
    });

    // Check that timer controls have proper labels
    expect(screen.getByTestId('pause-btn')).toBeInTheDocument();
    expect(screen.getByTestId('stop-btn')).toHaveTextContent('Stop');
    expect(screen.getByTestId('skip-btn')).toHaveTextContent('Skip to next phase');

    // Check that time display is readable
    const timeDisplay = screen.getByTestId('time-display');
    expect(timeDisplay).toHaveTextContent(/\d{2}:\d{2}/); // MM:SS format
  });

  it('handles edge cases gracefully', async () => {
    // Test with sermon that has no plan
    const sermonWithoutPlan = { ...mockSermon, plan: undefined };
    mockGetSermonById.mockResolvedValue(sermonWithoutPlan);

    useSearchParamsSpy.mockReturnValue({
      get: (key: string) => key === 'planView' ? 'preaching' : null,
      toString: () => 'planView=preaching',
    });

    render(<PlanPage />);

    await waitFor(() => {
      expect(screen.getByTestId('preaching-timer')).toBeInTheDocument();
    });

    // Should still work with no plan content
    expect(screen.getByText('Test Sermon')).toBeInTheDocument();
    expect(screen.getByText('No content available')).toBeInTheDocument();
  });
});
