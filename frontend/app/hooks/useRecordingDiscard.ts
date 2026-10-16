import { useCallback, useEffect, useRef, useState } from 'react';

import type { FailureWords } from '@/utils/actionFailureMessage';

/** One confirmed discard owns one source; its late result cannot clear a newer take. */
export function useRecordingDiscard({ source, discard, clear, onError, blocked = false }: {
  source: unknown;
  discard?: () => void | Promise<void>;
  clear: () => void;
  onError?: (words: FailureWords) => void;
  blocked?: boolean;
}) {
  const currentSource = useRef(source); currentSource.current = source;
  const mounted = useRef(false);
  const pending = useRef(false);
  const [isDiscarding, setIsDiscarding] = useState(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const discardSource = useCallback(async () => {
    if (pending.current || blocked) return;
    const captured = source;
    pending.current = true; setIsDiscarding(true);
    const current = () => mounted.current && currentSource.current === captured;
    try {
      await discard?.();
      if (current()) clear();
    } catch {
      if (current()) onError?.({ key: 'audio.draft.discardFailed' });
    } finally {
      pending.current = false;
      if (mounted.current) setIsDiscarding(false);
    }
  }, [source, discard, clear, onError, blocked]);
  return { discardSource, isDiscarding };
}
