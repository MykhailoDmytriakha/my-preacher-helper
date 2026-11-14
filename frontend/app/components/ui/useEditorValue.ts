import { useCallback, useState } from 'react';

import type { SetStateAction } from 'react';

/** Origin travels with the value produced by ONE state update, never with a later value. */
export function useEditorValue<T>(initial: T) {
  const [change, setChange] = useState({ value: initial, isUserAction: false });
  const apply = useCallback((next: SetStateAction<T>, isUserAction: boolean) => {
    setChange(previous => {
      const value = typeof next === 'function' ? (next as (value: T) => T)(previous.value) : next;
      return Object.is(value, previous.value) ? previous : { value, isUserAction };
    });
  }, []);
  const observe = useCallback((next: SetStateAction<T>) => apply(next, false), [apply]);
  const act = useCallback((next: SetStateAction<T>) => apply(next, true), [apply]);
  return { ...change, observe, act };
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
