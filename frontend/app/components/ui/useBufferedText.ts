'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * Bridge a text control to a delayed render of its document draft. The document owns
 * conflicts and persistence; this buffer only protects keystrokes not echoed yet.
 * Focus alone must never hide a newer document behind a stale editable value.
 * A change the document refuses (`onChange` rejects) will never echo: the field keeps the refused
 * words in view but no longer holds them over the document's next value.
 */
export function useBufferedText(value: string, onChange: (next: string) => void | Promise<unknown>) {
  const [draft, setDraft] = useState(value);
  const pending = useRef<string | null>(null);
  const attempts = useRef(0);
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
      const attempt = ++attempts.current;
      setDraft(next);
      const outcome = onChange(next);
      if (!(outcome instanceof Promise)) return;
      // A refused change keeps its words on screen — they may be the only copy — but the field stops
      // guarding them, so the next change of the document shows as usual. Only the latest change
      // counts: an older refusal says nothing about newer typing.
      outcome.catch(() => {
        if (attempt === attempts.current) pending.current = null;
      });
    },
  };
}
