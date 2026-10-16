import { useCallback, useEffect, useRef, useState } from 'react';

/** One microphone attempt belongs to its mounted recorder until final audio is handed off. */
export function useRecordingSession(onRecordingStateChange?: (active: boolean) => void) {
  const mounted = useRef(true);
  const generation = useRef(0);
  const current = useRef<number | null>(null);
  const notify = useRef(onRecordingStateChange);
  const [isActive, setIsActive] = useState(false);
  notify.current = onRecordingStateChange;

  const begin = useCallback(() => {
    if (!mounted.current || current.current !== null) return null;
    const token = ++generation.current;
    current.current = token;
    setIsActive(true);
    notify.current?.(true);
    return token;
  }, []);

  const owns = useCallback((token: number) =>
    mounted.current && current.current === token, []);

  const finish = useCallback(() => {
    const wasActive = current.current !== null;
    current.current = null;
    if (!mounted.current || !wasActive) return;
    setIsActive(false);
    notify.current?.(false);
  }, []);

  useEffect(() => {
    mounted.current = true;
    notify.current?.(false);
    return () => {
      mounted.current = false;
      const wasActive = current.current !== null;
      current.current = null;
      if (wasActive) notify.current?.(false);
    };
  }, []);

  return { isActive, begin, owns, finish };
}
