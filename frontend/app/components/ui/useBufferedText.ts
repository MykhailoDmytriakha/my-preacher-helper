'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * Bridge a text control to a delayed render of its document draft. The document owns
 * conflicts and persistence; this buffer only protects keystrokes not echoed yet.
 * Focus alone must never hide a newer document behind a stale editable value.
 */
export function useBufferedText(value: string, onChange: (next: string) => void) {
  const [draft, setDraft] = useState(value);
  const pending = useRef<string | null>(null);
  const latest = useRef(value);
  latest.current = value;

  useEffect(() => {
    if (pending.current === value) pending.current = null;
    if (pending.current === null) setDraft(value);
  }, [value]);

  return {
    draft,
    change: (next: string) => {
      pending.current = next === latest.current ? null : next;
      setDraft(next);
      onChange(next);
    },
  };
}
