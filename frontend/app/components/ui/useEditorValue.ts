import { useCallback, useRef, useState } from 'react';

import type { SetStateAction } from 'react';

interface EditorValueChange<T> {
  value: T;
  isUserAction: boolean;
  appended?: { before: T; after: T };
}

/** Origin travels with the value produced by one action. */
export function useEditorValue<T>(initial: T) {
  const [change, setChange] = useState<EditorValueChange<T>>({ value: initial, isUserAction: false });
  // Another action may arrive before React has shown the first one.
  const latest = useRef(change);
  const apply = useCallback((next: SetStateAction<T>, origin: 'observed' | 'action' | 'append') => {
    const previous = latest.current;
    const value = typeof next === 'function' ? (next as (value: T) => T)(previous.value) : next;
    if (!Object.is(value, previous.value)) {
      const updated = {
        value,
        isUserAction: origin !== 'observed',
        appended: origin === 'append' ? { before: previous.appended?.before ?? previous.value, after: value } : undefined,
      };
      latest.current = updated;
      setChange(updated);
    }
    return value;
  }, []);
  const observe = useCallback((next: SetStateAction<T>) => { apply(next, 'observed'); }, [apply]);
  const act = useCallback((next: SetStateAction<T>) => { apply(next, 'action'); }, [apply]);
  const append = useCallback((extend: (previous: T) => T) => apply(extend, 'append'), [apply]);
  return { ...change, observe, act, append };
}

/** Per-cell origins let one remote cell arrive in the same render as an unrelated own edit. */
export function useEditorValues() {
  const [change, setChange] = useState<{ value: Record<string, string>; userActionValues: Record<string, string> }>({ value: {}, userActionValues: {} });
  const apply = useCallback((next: SetStateAction<Record<string, string>>, isUserAction: boolean) => {
    setChange(previous => {
      const value = typeof next === 'function' ? next(previous.value) : next;
      const userActionValues = { ...previous.userActionValues };
      for (const key of new Set([...Object.keys(previous.value), ...Object.keys(value)])) {
        if (value[key] === previous.value[key]) continue;
        if (isUserAction && key in value) userActionValues[key] = value[key];
        else delete userActionValues[key];
      }
      return { value, userActionValues };
    });
  }, []);
  const observe = useCallback((next: SetStateAction<Record<string, string>>) => apply(next, false), [apply]);
  const act = useCallback((next: SetStateAction<Record<string, string>>) => apply(next, true), [apply]);
  return { ...change, observe, act };
}
