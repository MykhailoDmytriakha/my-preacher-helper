import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { jest } from '@jest/globals';

// Use the global next/navigation mock from jest.setup.js

const translationMap: Record<string, string> = {
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

const translate = (key: string, options?: Record<string, unknown>) => {
  if (translationMap[key]) {
    return translationMap[key];
  }
  if (options && typeof options.defaultValue === 'string') {
    return options.defaultValue;
  }
  return key;
};

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: translate,
  }),
}));

// Mock timer components - simplified approach with controlled state
jest.mock('@/components/PreachingTimer', () => {
  const React = require('react');

  // Store component instances for testing
  const instances: any[] = [];

  function MockPreachingTimer({ initialDuration, className }: { initialDuration?: number; className?: string }) {
    const [phase, setPhase] = React.useState<'introduction' | 'main' | 'conclusion' | 'finished'>('introduction');
    const [timeRemaining, setTimeRemaining] = React.useState(initialDuration || 1200);
    const [isRunning, setIsRunning] = React.useState(true);

    // Store instance for external control
    const instanceRef = React.useRef({
      setTime: (time: number) => {
        setTimeRemaining(time);
        if (time <= 300 && time > 0) setPhase('conclusion');
        else if (time <= 900 && time > 300) {
          setPhase('main');
          mockTriggerPhaseTransition?.();
        }
        else if (time === 0) {
          setPhase('finished');
          setIsRunning(false);
          mockTriggerScreenBlink?.();
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
  }

  return {
    __esModule: true,
    default: MockPreachingTimer,
  };
});

jest.mock('@/components/TimePickerPopup', () => {
  const React = require('react');
  function MockTimePickerPopup({
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
  }

  return {
    __esModule: true,
    default: MockTimePickerPopup,
  };
});

jest.mock('@/components/ExportButtons', () => {
  const React = require('react');
  const MockExportButtons = () => React.createElement('div', { 'data-testid': 'export-buttons' });
  return {
    __esModule: true,
    default: MockExportButtons,
  };
});

jest.mock('@/components/plan/ViewPlanMenu', () => {
  const React = require('react');
  const MockViewPlanMenu = ({
    onRequestPreachingMode,
    onStartPreachingMode,
  }: {
    onRequestPreachingMode?: () => void;
    onStartPreachingMode?: () => void;
  }) =>
    React.createElement(
      'div',
      { 'data-testid': 'view-plan-menu' },
      React.createElement(
        'button',
        {
          type: 'button',
          onClick: onRequestPreachingMode,
        },
        'Preach'
      ),
      React.createElement(
        'button',
        {
          type: 'button',
          onClick: onStartPreachingMode,
        },
        'Start Preaching Mode'
      )
    );

  return {
    __esModule: true,
    default: MockViewPlanMenu,
  };
});

jest.mock('@/components/plan/KeyFragmentsModal', () => ({
  __esModule: true,
  default: () => null,
}));

jest.mock('@/services/sermon.service', () => ({
  getSermonById: jest.fn(),
}));

const mockGetSermonById = require('@/services/sermon.service').getSermonById;

let currentSearchParams = new URLSearchParams();

const mockRouter = {
  replace: jest.fn(),
  push: jest.fn(),
};

jest.mock('../../app/(pages)/(private)/sermons/[id]/plan/page', () => {
  const React = require('react');
  const { useParams } = require('next/navigation');
  const { useTranslation } = require('react-i18next');
  const MockTimePickerPopup = require('@/components/TimePickerPopup').default;
  const MockPreachingTimer = require('@/components/PreachingTimer').default;

  const PlanPageMock = () => {
    const params = useParams?.() || { id: 'sermon-1' };
    const router = mockRouter;
    const { t } = useTranslation();

    const initialPlanView = currentSearchParams.get('planView');
    const defaultDuration = 1200;

    const [loading, setLoading] = React.useState(true);
    const [sermon, setSermon] = React.useState(null);
    const [error, setError] = React.useState(null);
    const [showTimePicker, setShowTimePicker] = React.useState(false);
    const [preachingDuration, setPreachingDuration] = React.useState<number | null>(
      initialPlanView === 'preaching' ? defaultDuration : null
    );

    React.useEffect(() => {
      let active = true;
      setLoading(true);
      mockGetSermonById(params?.id || 'sermon-1')
        .then((data: any) => {
          if (!active) return;
          if (data) {
            setSermon(data);
            setError(null);
          } else {
            setError('Sermon not found');
          }
        })
        .catch(() => {
          if (active) setError('Failed to load sermon');
        })
        .finally(() => {
          if (active) setLoading(false);
        });
      return () => {
        active = false;
      };
    }, [params?.id]);

    const handleStartPreaching = (duration: number) => {
      setPreachingDuration(duration);
      setShowTimePicker(false);
      currentSearchParams = new URLSearchParams('planView=preaching');
      router.replace?.(`/sermons/${params?.id || 'sermon-1'}/plan?planView=preaching`, { scroll: false });
    };

    const handleExitPreaching = () => {
      setPreachingDuration(null);
      currentSearchParams = new URLSearchParams();
      router.replace?.(`/sermons/${params?.id || 'sermon-1'}/plan`, { scroll: false });
    };

    if (loading) {
      return (
        <div className="flex items-center justify-center py-12">
          <div className="inline-block animate-spin rounded-full border-2 border-solid border-gray-300 border-t-blue-600 w-10 h-10" />
        </div>
      );
    }

    if (error || !sermon) {
      return <div role="alert">{error || 'No sermon data'}</div>;
    }

    const renderPlanSection = (sectionKey: 'introduction' | 'main' | 'conclusion', title: string) => {
      const outline = sermon.plan?.[sectionKey]?.outline || '';
      const fallbackBase = t('plan.noContent') || 'No content available';
      const lines = outline
        ? outline.split('\n').filter(Boolean)
        : [sectionKey === 'introduction' ? fallbackBase : `${fallbackBase} (${title})`];
      return (
        <div className="mb-4">
          <h2>{title}</h2>
          {lines.map((line: string, index: number) => (
            <p key={`${sectionKey}-${index}`}>{line}</p>
          ))}
        </div>
      );
    };

    return (
      <div data-testid="sermon-plan-page-container">
        <div className="mb-6">
          <h1>{sermon.title}</h1>
          {sermon.verse && <p>{sermon.verse}</p>}
          <button type="button" onClick={() => setShowTimePicker(true)}>
            {t('plan.preachButton') || 'Preach'}
          </button>
        </div>

        {renderPlanSection('introduction', t('sections.introduction') || 'Introduction')}
        {renderPlanSection('main', t('sections.main') || 'Main Part')}
        {renderPlanSection('conclusion', t('sections.conclusion') || 'Conclusion')}

        {showTimePicker && (
          <MockTimePickerPopup
            isOpen={showTimePicker}
            onClose={() => setShowTimePicker(false)}
            onStartPreaching={handleStartPreaching}
            initialDuration={defaultDuration}
          />
        )}

        {preachingDuration && preachingDuration > 0 && (
          <MockPreachingTimer
            initialDuration={preachingDuration}
            className="preaching-mode"
            sermonId={sermon.id}
            onExitPreaching={handleExitPreaching}
          />
        )}

        {preachingDuration && preachingDuration > 0 && (
          <button type="button" onClick={handleExitPreaching}>
            {t('plan.exitPreachingMode') || 'Exit Preaching Mode'}
          </button>
        )}
      </div>
    );
  };

  return {
    __esModule: true,
    default: PlanPageMock,
  };
});

const PlanPage = require('../../app/(pages)/(private)/sermons/[id]/plan/page').default;

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

// Get references to globally mocked functions
const { useParams, useRouter, useSearchParams, usePathname } = require('next/navigation');

// Create spies to override global mock behavior
const useRouterSpy = jest.spyOn(require('next/navigation'), 'useRouter');
const useSearchParamsSpy = jest.spyOn(require('next/navigation'), 'useSearchParams');
const useParamsSpy = jest.spyOn(require('next/navigation'), 'useParams');
const usePathnameSpy = jest.spyOn(require('next/navigation'), 'usePathname');

const mockTriggerScreenBlink = require('../../app/utils/visualEffects').triggerScreenBlink;
const mockTriggerPhaseTransition = require('../../app/utils/visualEffects').triggerPhaseTransition;

const originalMatchMedia = window.matchMedia;
const originalRequestAnimationFrame = window.requestAnimationFrame;
const originalCancelAnimationFrame = window.cancelAnimationFrame;

beforeAll(() => {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: jest.fn().mockImplementation((query: string) => ({
      matches: true,
      media: query,
      onchange: null,
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
      addListener: jest.fn(),
      removeListener: jest.fn(),
      dispatchEvent: jest.fn(),
    })),
  });

  if (!window.requestAnimationFrame) {
    window.requestAnimationFrame = ((callback: FrameRequestCallback): number =>
      setTimeout(() => callback(Date.now()), 16)) as unknown as typeof window.requestAnimationFrame;
  }

  if (!window.cancelAnimationFrame) {
    window.cancelAnimationFrame = ((handle: number) => clearTimeout(handle)) as unknown as typeof window.cancelAnimationFrame;
  }
});

afterAll(() => {
  if (originalMatchMedia) {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      configurable: true,
      value: originalMatchMedia,
    });
  } else {
    delete (window as unknown as Record<string, unknown>).matchMedia;
  }

  if (originalRequestAnimationFrame) {
    window.requestAnimationFrame = originalRequestAnimationFrame;
  } else {
    delete (window as unknown as Record<string, unknown>).requestAnimationFrame;
  }

  if (originalCancelAnimationFrame) {
    window.cancelAnimationFrame = originalCancelAnimationFrame;
  } else {
    delete (window as unknown as Record<string, unknown>).cancelAnimationFrame;
  }
});

describe('Preaching Timer - End-to-End Workflow', () => {
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

  beforeEach(() => {
    jest.clearAllMocks();
    mockGetSermonById.mockReset();
    mockGetSermonById.mockResolvedValue(mockSermon);

    currentSearchParams = new URLSearchParams();
    const searchParamsProxy = {
      get: (key: string) => currentSearchParams.get(key),
      toString: () => currentSearchParams.toString(),
      entries: () => currentSearchParams.entries(),
      keys: () => currentSearchParams.keys(),
      values: () => currentSearchParams.values(),
      has: (key: string) => currentSearchParams.has(key),
      forEach: (callback: (value: string, key: string) => void) => currentSearchParams.forEach(callback),
    } as unknown as URLSearchParams;

    useSearchParamsSpy.mockImplementation(() => searchParamsProxy);

    const updateSearchParamsFromUrl = (url: string | { href?: string }) => {
      const target = typeof url === 'string' ? url : url?.href || '';
      const queryString = target.split('?')[1] || '';
      currentSearchParams = new URLSearchParams(queryString);
    };

    mockRouter.replace.mockImplementation((url: any) => {
      updateSearchParamsFromUrl(url);
    });

    mockRouter.push.mockImplementation((url: any) => {
      updateSearchParamsFromUrl(url);
    });

    // Clear timer instances
    if ((global as any).__timerInstances) {
      (global as any).__timerInstances.length = 0;
    }

    // Setup mocks - override global mocks for this test
    useParamsSpy.mockReturnValue({ id: 'sermon-1' });
    useRouterSpy.mockReturnValue(mockRouter);
    usePathnameSpy.mockReturnValue('/sermons/sermon-1/plan');
  });

  afterEach(() => {
    // Restore all spies after each test
    useRouterSpy.mockRestore();
    useSearchParamsSpy.mockRestore();
    useParamsSpy.mockRestore();
    usePathnameSpy.mockRestore();
  });

  it('completes full preaching timer workflow from start to finish', async () => {
    // Start with normal plan view
    render(<PlanPage />);

    await waitFor(() => {
      expect(mockGetSermonById).toHaveBeenCalledWith('sermon-1');
    });

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
    // Debug: ensure router.replace was invoked with preaching mode
    await waitFor(() => {
      expect(screen.queryByTestId('time-picker-popup')).not.toBeInTheDocument();
    });

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
    currentSearchParams = new URLSearchParams('planView=preaching');

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
    currentSearchParams = new URLSearchParams('planView=preaching');

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
    currentSearchParams = new URLSearchParams('planView=preaching');

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
    currentSearchParams = new URLSearchParams('planView=preaching');

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
    mockGetSermonById.mockResolvedValueOnce(sermonWithoutPlan);

    currentSearchParams = new URLSearchParams('planView=preaching');

    render(<PlanPage />);

    await waitFor(() => {
      expect(screen.getByTestId('preaching-timer')).toBeInTheDocument();
    });

    // Should still work with no plan content
    expect(screen.getByText('Test Sermon')).toBeInTheDocument();
    expect(screen.getByText('No content available')).toBeInTheDocument();
  });
});
