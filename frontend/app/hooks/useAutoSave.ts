import debounce from 'lodash/debounce';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

export type AutoSaveStatus = 'idle' | 'saving' | 'saved' | 'error';

interface UseAutoSaveOptions {
    /**
     * Delay in milliseconds before saving. Default is 500ms.
     */
    delay?: number;
    /**
     * Callback invoked when a save error occurs.
     */
    onError?: (error: unknown) => void;
}

/**
 * Encapsulates standard auto-save debouncing logic and UI status transitions.
 * Automatically flushes pending saves on component unmount.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function useAutoSave<T extends (...args: any[]) => Promise<void>>(
    saveFunction: T,
    options: UseAutoSaveOptions = {}
) {
    const { delay = 500 } = options;

    const [status, setStatus] = useState<AutoSaveStatus>('idle');
    const statusTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
    const isMountedRef = useRef(false);

    // Update refs during the render phase so they are instantly available 
    // to asynchronous callbacks and tests without waiting for passive effects.
    const saveFunctionRef = useRef(saveFunction);
    const optionsRef = useRef(options);
    saveFunctionRef.current = saveFunction;
    optionsRef.current = options;

    const performSave = useCallback(
        async (...args: Parameters<T>) => {
            try {
                clearTimeout(statusTimerRef.current);
                if (isMountedRef.current) setStatus('saving');
                await saveFunctionRef.current(...args);

                if (!isMountedRef.current) return;

                setStatus('saved');
                clearTimeout(statusTimerRef.current);
                statusTimerRef.current = setTimeout(() => {
                    if (isMountedRef.current) setStatus('idle');
                }, 2000);
            } catch (error) {
                console.error('Failed auto-save operation:', error);
                clearTimeout(statusTimerRef.current);
                if (isMountedRef.current) setStatus('error');
                const { onError } = optionsRef.current;
                if (isMountedRef.current && onError) {
                    onError(error);
                }
            }
        },
        []
    );

    // Stable identity debounce
    const debouncedSave = useMemo(
        () => debounce(performSave, delay),
        [performSave, delay]
    );

    const saveNow = useCallback(
        async (...args: Parameters<T>) => {
            debouncedSave.cancel();
            await performSave(...args);
        },
        [debouncedSave, performSave]
    );

    // Flush any pending saves on unmount
    useEffect(() => {
        isMountedRef.current = true;

        return () => {
            isMountedRef.current = false;
            // eslint-disable-next-line react-hooks/exhaustive-deps
            debouncedSave.flush();
            debouncedSave.cancel();
            clearTimeout(statusTimerRef.current);
            statusTimerRef.current = undefined;
        };
    }, [debouncedSave]);

    return {
        debouncedSave,
        saveNow,
        status,
    };
}
