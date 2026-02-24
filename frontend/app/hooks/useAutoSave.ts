import debounce from 'lodash/debounce';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

export type AutoSaveStatus = 'idle' | 'saving' | 'saved';

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

    // Update refs during the render phase so they are instantly available 
    // to asynchronous callbacks and tests without waiting for passive effects.
    const saveFunctionRef = useRef(saveFunction);
    const optionsRef = useRef(options);
    saveFunctionRef.current = saveFunction;
    optionsRef.current = options;

    const performSave = useCallback(
        async (...args: Parameters<T>) => {
            try {
                setStatus('saving');
                await saveFunctionRef.current(...args);

                setStatus('saved');
                clearTimeout(statusTimerRef.current);
                statusTimerRef.current = setTimeout(() => setStatus('idle'), 2000);
            } catch (error) {
                console.error('Failed auto-save operation:', error);
                setStatus('idle');
                const { onError } = optionsRef.current;
                if (onError) {
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

    // Flush any pending saves on unmount
    useEffect(() => {
        return () => {
            // eslint-disable-next-line react-hooks/exhaustive-deps
            debouncedSave.flush();
            clearTimeout(statusTimerRef.current);
        };
    }, [debouncedSave]);

    return {
        debouncedSave,
        status,
    };
}
