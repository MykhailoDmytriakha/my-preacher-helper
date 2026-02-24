import { act, renderHook } from '@testing-library/react';

import { formatTime, useConductTimer } from '@/hooks/useConductTimer';

describe('useConductTimer', () => {
    beforeEach(() => {
        jest.useFakeTimers();
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    it('initializes correctly with no duration', () => {
        const { result } = renderHook(() => useConductTimer(null));

        expect(result.current.elapsed).toBe(0);
        expect(result.current.timeLeft).toBeNull();
        expect(result.current.isOvertime).toBe(false);
        expect(result.current.isWarning).toBe(false);
    });

    it('increments elapsed time when not paused', () => {
        const { result } = renderHook(() => useConductTimer(null));

        act(() => {
            jest.advanceTimersByTime(3000);
        });

        expect(result.current.elapsed).toBe(3);
    });

    it('stops counting when isPaused=true and resumes when isPaused=false', () => {
        let isPaused = false;
        const { result, rerender } = renderHook(() => useConductTimer(null, isPaused));

        act(() => {
            jest.advanceTimersByTime(2000);
        });
        expect(result.current.elapsed).toBe(2);

        // Pause
        isPaused = true;
        rerender();

        act(() => {
            jest.advanceTimersByTime(3000);
        });
        // Shouldn't increase while paused
        expect(result.current.elapsed).toBe(2);

        // Resume
        isPaused = false;
        rerender();

        act(() => {
            jest.advanceTimersByTime(1000);
        });
        expect(result.current.elapsed).toBe(3);
    });

    it('calculates time left, warning and overtime correctly based on duration', () => {
        // 2 minutes duration -> 120 seconds
        const { result } = renderHook(() => useConductTimer(2));

        expect(result.current.timeLeft).toBe(120);
        expect(result.current.isWarning).toBe(false);
        expect(result.current.isOvertime).toBe(false);

        // Advance 60 seconds. Remaining: 60 seconds (warning zone)
        act(() => {
            jest.advanceTimersByTime(60000);
        });
        expect(result.current.timeLeft).toBe(60);
        expect(result.current.isWarning).toBe(true);
        expect(result.current.isOvertime).toBe(false);

        // Advance 61 seconds. Remaining: -1 seconds (overtime zone)
        act(() => {
            jest.advanceTimersByTime(61000);
        });
        expect(result.current.timeLeft).toBe(-1);
        expect(result.current.isWarning).toBe(false);
        expect(result.current.isOvertime).toBe(true);
    });
});

describe('formatTime', () => {
    it('formats positive seconds correctly', () => {
        expect(formatTime(0)).toBe('00:00');
        expect(formatTime(59)).toBe('00:59');
        expect(formatTime(60)).toBe('01:00');
        expect(formatTime(65)).toBe('01:05');
        expect(formatTime(3605)).toBe('60:05'); // Just verifying it works for more than 60 mins without wrapping
    });

    it('formats negative seconds correctly with a leading minus', () => {
        expect(formatTime(-1)).toBe('-00:01');
        expect(formatTime(-65)).toBe('-01:05');
        expect(formatTime(-3605)).toBe('-60:05');
    });
});
