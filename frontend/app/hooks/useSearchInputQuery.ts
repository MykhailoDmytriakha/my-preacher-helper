'use client';

import { useQueryState } from 'nuqs';
import { useCallback, useEffect, useRef, useState } from 'react';

type SearchInputOptions = { emptyWhenBlank?: boolean };

/**
 * Instant authored input with the existing shallow URL writer. Keep the local mirror used
 * by Studies: optimistic URL reconciliation must not flash an older value during clear/Escape.
 * External URL changes are adopted while the person is not editing this input. Explicit Back
 * and Forward restore their query even while focused. The query
 * library retains history, batching, browser rate limits and navigation queue resets.
 */
export function useSearchInputQuery(key: string, { emptyWhenBlank = false }: SearchInputOptions = {}) {
  const [query, setQuery] = useQueryState(key, { defaultValue: '', throttleMs: 0 });
  const [value, setValue] = useState(query);
  const inputRef = useRef<HTMLInputElement>(null);

  const apply = useCallback((next: string) => {
    setValue(next);
    void setQuery(emptyWhenBlank && !next.trim() ? null : next);
  }, [emptyWhenBlank, setQuery]);

  useEffect(() => {
    // History is an explicit user choice, unlike a late optimistic query acknowledgement.
    // Read its string value without writing it back: Nuqs owns queue resets and history.
    const restoreHistoryQuery = () => setValue(new URLSearchParams(window.location.search).get(key) ?? '');
    window.addEventListener('popstate', restoreHistoryQuery);
    return () => window.removeEventListener('popstate', restoreHistoryQuery);
  }, [key]);

  useEffect(() => {
    if (query !== value && document.activeElement !== inputRef.current) setValue(query);
    // The URL owns this effect. Local typing alone must not re-adopt an older URL snapshot.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  return { value, setValue: apply, inputRef };
}
