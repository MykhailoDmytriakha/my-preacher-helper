import { act, renderHook } from '@testing-library/react';

import { useAutoSave } from '../useAutoSave';

function createDeferred<T = void>() {
    let resolve!: (value: T | PromiseLike<T>) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
        resolve = res;
        reject = rej;
    });

    return { promise, resolve, reject };
}

describe('useAutoSave', () => {
    let consoleErrorSpy: jest.SpyInstance;

    beforeEach(() => {
        jest.useFakeTimers();
        consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    });

    afterEach(() => {
        jest.clearAllTimers();
        jest.useRealTimers();
        consoleErrorSpy.mockRestore();
        jest.clearAllMocks();
    });

    it('moves from idle to saving to saved and then returns to idle', async () => {
        const saveAttempt = createDeferred();
        const saveFunction = jest.fn(() => saveAttempt.promise);
        const { result } = renderHook(() => useAutoSave(saveFunction, { delay: 50 }));

        expect(result.current.status).toBe('idle');

        act(() => {
            result.current.debouncedSave();
            jest.advanceTimersByTime(50);
        });

        expect(saveFunction).toHaveBeenCalledTimes(1);
        expect(result.current.status).toBe('saving');

        await act(async () => {
            saveAttempt.resolve();
            await saveAttempt.promise;
        });

        expect(result.current.status).toBe('saved');

        act(() => {
            jest.advanceTimersByTime(1999);
        });
        expect(result.current.status).toBe('saved');

        act(() => {
            jest.advanceTimersByTime(1);
        });
        expect(result.current.status).toBe('idle');
    });

    it('moves from idle to saving to error when the save rejects', async () => {
        const saveAttempt = createDeferred();
        const saveError = new Error('save failed');
        const onError = jest.fn();
        const saveFunction = jest.fn(() => saveAttempt.promise);
        const { result } = renderHook(() => useAutoSave(saveFunction, { delay: 50, onError }));

        act(() => {
            result.current.debouncedSave();
            jest.advanceTimersByTime(50);
        });

        expect(result.current.status).toBe('saving');

        await act(async () => {
            saveAttempt.reject(saveError);
            await saveAttempt.promise.catch(() => undefined);
        });

        expect(result.current.status).toBe('error');
        expect(onError).toHaveBeenCalledWith(saveError);
    });

    it('keeps error sticky until the next save attempt resets status', async () => {
        const failedAttempt = createDeferred();
        const successfulAttempt = createDeferred();
        const saveFunction = jest
            .fn()
            .mockReturnValueOnce(failedAttempt.promise)
            .mockReturnValueOnce(successfulAttempt.promise);
        const { result } = renderHook(() => useAutoSave(saveFunction, { delay: 50 }));

        act(() => {
            result.current.debouncedSave();
            jest.advanceTimersByTime(50);
        });

        await act(async () => {
            failedAttempt.reject(new Error('temporary failure'));
            await failedAttempt.promise.catch(() => undefined);
        });

        expect(result.current.status).toBe('error');

        act(() => {
            jest.advanceTimersByTime(2000);
        });
        expect(result.current.status).toBe('error');

        act(() => {
            result.current.debouncedSave();
            jest.advanceTimersByTime(50);
        });

        expect(result.current.status).toBe('saving');

        await act(async () => {
            successfulAttempt.resolve();
            await successfulAttempt.promise;
        });

        expect(result.current.status).toBe('saved');
    });

    it('does not schedule the idle status timer after unmounting during an in-flight save', async () => {
        const saveAttempt = createDeferred();
        const saveFunction = jest.fn(() => saveAttempt.promise);
        const setTimeoutSpy = jest.spyOn(global, 'setTimeout');
        const { result, unmount } = renderHook(() => useAutoSave(saveFunction, { delay: 50 }));

        act(() => {
            result.current.debouncedSave();
            jest.advanceTimersByTime(50);
        });

        expect(result.current.status).toBe('saving');

        unmount();
        const timerCallsBeforeResolve = setTimeoutSpy.mock.calls.length;

        await act(async () => {
            saveAttempt.resolve();
            await saveAttempt.promise;
        });

        expect(setTimeoutSpy).toHaveBeenCalledTimes(timerCallsBeforeResolve);
        setTimeoutSpy.mockRestore();
    });
});
