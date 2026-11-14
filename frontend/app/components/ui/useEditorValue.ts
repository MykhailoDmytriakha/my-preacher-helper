import { useCallback, useLayoutEffect, useRef, useState } from 'react';

import type { SetStateAction } from 'react';

interface ForeignValue<T> { value: T }

/** Origin and any unrendered foreign baseline travel with the value, never with ambient form state. */
export function useEditorValue<T>(initial: T) {
  const [change, setChange] = useState<{ value: T; isUserAction: boolean; foreignValueBeforeAction?: ForeignValue<T> }>({ value: initial, isUserAction: false });
  const committed = useRef(change);
  useLayoutEffect(() => { committed.current = change; }, [change]);
  const apply = useCallback((next: SetStateAction<T>, isUserAction: boolean) => {
    setChange(previous => {
      const value = typeof next === 'function' ? (next as (value: T) => T)(previous.value) : next;
      if (Object.is(value, previous.value)) return previous;
      const foreignValueBeforeAction = isUserAction
        ? previous !== committed.current ? previous.foreignValueBeforeAction : undefined
        : { value };
      return { value, isUserAction, foreignValueBeforeAction };
    });
  }, []);
  const observe = useCallback((next: SetStateAction<T>) => apply(next, false), [apply]);
  const act = useCallback((next: SetStateAction<T>) => apply(next, true), [apply]);
  return { ...change, observe, act };
}

/** Each cell retains its own foreign baseline when observations and actions share a render. */
export function useEditorValues() {
  const [change, setChange] = useState<{
    value: Record<string, string>;
    userActionValues: Record<string, string>;
    foreignValuesBeforeAction: Record<string, ForeignValue<string>>;
  }>({ value: {}, userActionValues: {}, foreignValuesBeforeAction: {} });
  const committed = useRef(change);
  useLayoutEffect(() => { committed.current = change; }, [change]);
  const apply = useCallback((next: SetStateAction<Record<string, string>>, isUserAction: boolean) => {
    setChange(previous => {
      const value = typeof next === 'function' ? next(previous.value) : next;
      const userActionValues = { ...previous.userActionValues };
      const foreignValuesBeforeAction = previous !== committed.current ? { ...previous.foreignValuesBeforeAction } : {};
      for (const key of new Set([...Object.keys(previous.value), ...Object.keys(value)])) {
        if (value[key] === previous.value[key]) continue;
        if (isUserAction && key in value) userActionValues[key] = value[key];
        else {
          delete userActionValues[key];
          foreignValuesBeforeAction[key] = { value: value[key] ?? '' };
        }
      }
      return { value, userActionValues, foreignValuesBeforeAction };
    });
  }, []);
  const observe = useCallback((next: SetStateAction<Record<string, string>>) => apply(next, false), [apply]);
  const act = useCallback((next: SetStateAction<Record<string, string>>) => apply(next, true), [apply]);
  return { ...change, observe, act };
}
