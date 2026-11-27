'use client';

import { createContext, useCallback, useContext, useLayoutEffect, useRef, useState } from 'react';

export const BufferedTextScope = createContext<object | null>(null);

/**
 * Bridge a text control to a delayed render of its document draft. The document owns
 * conflicts and persistence; this buffer only protects keystrokes not echoed yet.
 * Focus alone must never hide a newer document behind a stale editable value.
 * A change the document refuses (`onChange` rejects) will never echo: the field keeps the refused
 * words in view but no longer holds them over the document's next value. A scoped field
 * keeps those words available if the document never echoed them.
 */
export function useBufferedText(value: string, onChange: (next: string, editOpening?: string) => void | Promise<unknown>, acceptedInput?: string) {
  const scope = useContext(BufferedTextScope);
  const scopeRef = useRef(scope);
  const [draft, setDraft] = useState(value);
  const shown = useRef(draft);
  shown.current = draft;
  const [refused, setRefused] = useState<{ scope: object; texts: string[] } | null>(null);
  const pending = useRef<string | null>(null);
  const attempts = useRef(0);
  const latest = useRef(value);
  latest.current = value;

  // Reconcile document echoes before the next native input. A passive mirror can leave
  // deferred state work between continuous keystrokes and controlled-input restoration.
  useLayoutEffect(() => {
    if (scopeRef.current !== scope) {
      scopeRef.current = scope;
      pending.current = null;
      attempts.current++;
      setRefused(null);
    }
    if (pending.current === value || pending.current === acceptedInput) pending.current = null;
    if (pending.current === null) setDraft(value);
  }, [value, acceptedInput, scope]);

  useLayoutEffect(() => {
    setRefused(previous => {
      if (!previous) return null;
      const texts = previous.texts.filter(text => text !== value && text !== acceptedInput);
      return texts.length === previous.texts.length ? previous : texts.length ? { ...previous, texts } : null;
    });
  }, [value, acceptedInput]);

  const getPending = useCallback((): string | null => pending.current, []);

  return {
    draft,
    refusedText: refused && refused.scope === scope
      ? refused.texts.filter(text => text !== draft && text !== value && text !== acceptedInput)
      : [],
    getPending,
    takeObserved: () => {
      pending.current = null;
      attempts.current++;
      setDraft(latest.current);
    },
    change: (next: string, editOpening?: string) => {
      const edited = editOpening ?? shown.current;
      if (scope) setRefused(previous => {
        if (!previous || previous.scope !== scope) return previous;
        const texts = previous.texts.filter(text => text !== edited);
        return texts.length === previous.texts.length ? previous : texts.length ? { ...previous, texts } : null;
      });
      shown.current = next;
      pending.current = next === latest.current ? null : next;
      const opening = latest.current;
      const attempt = ++attempts.current;
      setDraft(next);
      const outcome = editOpening === undefined ? onChange(next) : onChange(next, editOpening);
      if (!(outcome instanceof Promise)) return;
      // A refused change keeps its words on screen — they may be the only copy — but the field stops
      // guarding them, so the next change of the document shows as usual. Only the latest change
      // counts: an older refusal says nothing about newer typing.
      outcome.catch(() => {
        if (attempt !== attempts.current) return;
        pending.current = null;
        if (scope && latest.current !== next) {
          setRefused(previous => {
            const texts = previous?.scope === scope ? previous.texts : [];
            return texts.includes(next) ? previous : { scope, texts: [...texts, next] };
          });
        }
        if (latest.current !== opening) setDraft(latest.current);
      });
      return outcome;
    },
  };
}
