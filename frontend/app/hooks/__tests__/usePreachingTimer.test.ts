import { renderHook, act } from '@testing-library/react';
import { usePreachingTimer } from '../usePreachingTimer';

// Mock timer functions
jest.useFakeTimers();

describe('usePreachingTimer', () => {
  beforeEach(() => {
    jest.clearAllTimers();
  });

  it('should initialize with default state', () => {
    const { result } = renderHook(() => usePreachingTimer());

    expect(result.current.timerState.status).toBe('idle');
    expect(result.current.timerState.isRunning).toBe(false);
    expect(result.current.timerState.isPaused).toBe(false);
    expect(result.current.timerState.isFinished).toBe(false);
    expect(result.current.timerState.currentPhase).toBe('introduction');
    expect(result.current.timerState.timeRemaining).toBe(1200); // 20 minutes
  });

  it('should start timer', () => {
    const { result } = renderHook(() => usePreachingTimer());

    act(() => {
      result.current.actions.start();
    });

    expect(result.current.timerState.status).toBe('running');
    expect(result.current.timerState.isRunning).toBe(true);
    expect(result.current.timerState.isPaused).toBe(false);
  });

  it('should pause timer', () => {
    const { result } = renderHook(() => usePreachingTimer());

    act(() => {
      result.current.actions.start();
      result.current.actions.pause();
    });

    expect(result.current.timerState.status).toBe('paused');
    expect(result.current.timerState.isRunning).toBe(false);
    expect(result.current.timerState.isPaused).toBe(true);
  });

  it('should resume timer', () => {
    const { result } = renderHook(() => usePreachingTimer());

    act(() => {
      result.current.actions.start();
      result.current.actions.pause();
      result.current.actions.resume();
    });

    expect(result.current.timerState.status).toBe('running');
    expect(result.current.timerState.isRunning).toBe(true);
    expect(result.current.timerState.isPaused).toBe(false);
  });

  it('should stop timer', () => {
    const { result } = renderHook(() => usePreachingTimer());

    act(() => {
      result.current.actions.start();
      result.current.actions.stop();
    });

    expect(result.current.timerState.status).toBe('idle');
    expect(result.current.timerState.isRunning).toBe(false);
    expect(result.current.timerState.isPaused).toBe(false);
    expect(result.current.timerState.timeRemaining).toBe(1200); // Reset to initial
  });

  it('should countdown time', () => {
    const { result } = renderHook(() => usePreachingTimer());

    act(() => {
      result.current.actions.start();
    });

    // Fast-forward 5 seconds
    act(() => {
      jest.advanceTimersByTime(5000);
    });

    expect(result.current.timerState.timeRemaining).toBe(1195); // 1200 - 5
  });

  it('should transition phases correctly', () => {
    const { result } = renderHook(() => usePreachingTimer());

    act(() => {
      result.current.actions.start();
    });

    // Introduction phase: 0-240 seconds (20% of 1200)
    expect(result.current.timerState.currentPhase).toBe('introduction');

    // Fast-forward to main phase (241+ seconds)
    act(() => {
      jest.advanceTimersByTime(241000); // 241 seconds
    });

    expect(result.current.timerState.currentPhase).toBe('main');

    // Fast-forward to conclusion phase (961+ seconds)
    act(() => {
      jest.advanceTimersByTime(720000); // Additional 720 seconds (total 961)
    });

    expect(result.current.timerState.currentPhase).toBe('conclusion');
  });

  it('should finish timer', () => {
    const { result } = renderHook(() => usePreachingTimer());

    act(() => {
      result.current.actions.start();
    });

    // Fast-forward to end
    act(() => {
      jest.advanceTimersByTime(1200000); // 1200 seconds = 20 minutes
    });

    expect(result.current.timerState.status).toBe('finished');
    expect(result.current.timerState.isFinished).toBe(true);
    expect(result.current.timerState.timeRemaining).toBe(0);
  });

  it('should format display time correctly', () => {
    const { result } = renderHook(() => usePreachingTimer());

    act(() => {
      result.current.actions.start();
    });

    // Check initial time
    expect(result.current.visualState.displayTime).toBe('20:00'); // 1200 seconds = 20:00

    // Fast-forward 65 seconds
    act(() => {
      jest.advanceTimersByTime(65000);
    });

    expect(result.current.visualState.displayTime).toBe('18:55'); // 1200 - 65 = 1135 seconds = 18:55
  });

  it('should calculate progress correctly', () => {
    const { result } = renderHook(() => usePreachingTimer());

    act(() => {
      result.current.actions.start();
    });

    // Check initial progress
    expect(result.current.progress.totalProgress).toBe(0);
    expect(result.current.progress.phaseProgress).toBe(0);

    // Fast-forward 60 seconds (1 minute = 5% of 20 minutes)
    act(() => {
      jest.advanceTimersByTime(60000);
    });

    expect(result.current.progress.totalProgress).toBeCloseTo(0.05, 2); // 5%
    expect(result.current.progress.phaseProgress).toBeCloseTo(0.05 / 0.2, 2); // 25% through intro phase
  });

  it('should reset timer', () => {
    const { result } = renderHook(() => usePreachingTimer());

    act(() => {
      result.current.actions.start();
      jest.advanceTimersByTime(10000); // 10 seconds
      result.current.actions.reset();
    });

    expect(result.current.timerState.status).toBe('idle');
    expect(result.current.timerState.timeRemaining).toBe(1200);
    expect(result.current.timerState.currentPhase).toBe('introduction');
  });

  it('should skip to next phase and jump time', () => {
    const { result } = renderHook(() => usePreachingTimer());

    act(() => {
      result.current.actions.start();
    });

    // Initially in introduction phase
    expect(result.current.timerState.currentPhase).toBe('introduction');
    expect(result.current.timerState.timeRemaining).toBe(1200); // total duration

    // Skip from introduction to main phase
    act(() => {
      result.current.actions.skip();
    });

    expect(result.current.timerState.currentPhase).toBe('main');
    // After skipping from intro to main, should give full remaining time (main + conclusion)
    expect(result.current.timerState.timeRemaining).toBe(960); // 1200 - 240 (elapsed)

    // Skip from main to conclusion phase
    act(() => {
      result.current.actions.skip();
    });

    expect(result.current.timerState.currentPhase).toBe('conclusion');
    // After skipping from main to conclusion, should give conclusion duration
    expect(result.current.timerState.timeRemaining).toBe(240); // conclusion duration

    // Skip from conclusion finishes the timer immediately
    act(() => {
      result.current.actions.skip();
    });

    expect(result.current.timerState.status).toBe('finished');
    expect(result.current.timerState.isFinished).toBe(true);
    expect(result.current.timerState.timeRemaining).toBe(0);
    expect(result.current.timerState.currentPhase).toBe('finished');
  });

  it('should skip correctly from middle of main phase', () => {
    const { result } = renderHook(() => usePreachingTimer());

    act(() => {
      result.current.actions.start();
    });

    // Skip from introduction to main first
    act(() => {
      result.current.actions.skip();
    });

    expect(result.current.timerState.currentPhase).toBe('main');
    expect(result.current.timerState.timeRemaining).toBe(960); // total remaining after skip to main

    // Simulate some time passing in main phase (user sees main phase)
    act(() => {
      jest.advanceTimersByTime(200000); // 200 seconds
    });

    // Should still be in main phase with less time remaining
    expect(result.current.timerState.currentPhase).toBe('main');
    expect(result.current.timerState.timeRemaining).toBe(760); // 960 - 200

    // Now skip from main to conclusion - should give full conclusion duration and reset progress
    act(() => {
      result.current.actions.skip();
    });

    expect(result.current.timerState.currentPhase).toBe('conclusion');
    expect(result.current.timerState.timeRemaining).toBe(240); // total remaining after skip to conclusion (1200 - 240 - 720)
  });

  it('should handle skip correctly when timer has been running for extended time', () => {
    const { result } = renderHook(() => usePreachingTimer());

    act(() => {
      result.current.actions.start();
    });

    // Skip to main phase
    act(() => {
      result.current.actions.skip();
    });

    expect(result.current.timerState.currentPhase).toBe('main');
    expect(result.current.timerState.timeRemaining).toBe(960);

    // Let significant time pass (still within main phase time limit)
    act(() => {
      jest.advanceTimersByTime(600000); // 600 seconds - should still be in main phase
    });

    // Should still be in main phase with remaining time
    expect(result.current.timerState.currentPhase).toBe('main');
    expect(result.current.timerState.timeRemaining).toBe(360); // 960 - 600

    // Skip should still work and give full conclusion duration
    act(() => {
      result.current.actions.skip();
    });

    expect(result.current.timerState.currentPhase).toBe('conclusion');
    expect(result.current.timerState.timeRemaining).toBe(240); // total remaining after skip to conclusion
  });

  it('should handle skip correctly even when currentPhase is auto-updated to conclusion', () => {
    const { result } = renderHook(() => usePreachingTimer());

    act(() => {
      result.current.actions.start();
    });

    // Simulate being in main phase but currentPhase auto-updated to conclusion due to elapsed time
    // This can happen if timer runs long enough that calculateCurrentPhase returns 'conclusion'
    // but user still sees main phase visually

    // Fast-forward to a time when we're still in main phase by timeRemaining,
    // but calculateCurrentPhase would return 'conclusion' (after 960+ seconds)
    act(() => {
      jest.advanceTimersByTime(961000); // 961 seconds - past the main phase threshold
    });

    // At this point, currentPhase should be 'conclusion' due to auto-update,
    // but if we were still in main phase visually, skip should still work correctly
    expect(result.current.timerState.currentPhase).toBe('conclusion');

    // But skip from what should be main phase should still go to conclusion with full time
    // Since calculateCurrentPhase determines we're in conclusion, skip should finish the timer
    act(() => {
      result.current.actions.skip();
    });

    expect(result.current.timerState.status).toBe('finished');
    expect(result.current.timerState.isFinished).toBe(true);
    expect(result.current.timerState.timeRemaining).toBe(0);
  });
});
