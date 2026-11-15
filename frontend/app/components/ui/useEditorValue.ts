import { useCallback, useLayoutEffect, useRef, useState } from 'react';

import type { SetStateAction } from 'react';

interface ForeignValue<T> { value: T }

interface EditorValueChange<T> {
  value: T;
  isUserAction: boolean;
  foreignValueBeforeAction?: ForeignValue<T>;
  appended?: { before: T; after: T };
}

/** Origin travels with the value produced by one action. */
export function useEditorValue<T>(initial: T) {
  const [change, setChange] = useState<EditorValueChange<T>>({ value: initial, isUserAction: false });
  // Another action may arrive before React has shown the first one.
  const latest = useRef(change);
  const committed = useRef(change);
  useLayoutEffect(() => { committed.current = change; }, [change]);
  const apply = useCallback((next: SetStateAction<T>, origin: 'observed' | 'action' | 'append') => {
    const previous = latest.current;
    const value = typeof next === 'function' ? (next as (value: T) => T)(previous.value) : next;
    if (!Object.is(value, previous.value)) {
      const updated = {
        value,
        isUserAction: origin !== 'observed',
        foreignValueBeforeAction: origin === 'observed' ? { value }
          : previous !== committed.current ? previous.foreignValueBeforeAction : undefined,
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
  const readAppend = useCallback(() => latest.current.appended, []);
  return { ...change, observe, act, append, readAppend };
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
