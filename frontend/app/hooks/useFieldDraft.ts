'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * THE DRAFT OF ONE FIELD THAT HAS ITS OWN SAVE BUTTON.
 *
 * It follows the stored value until the person types; then it keeps their words. A newer copy of
 * the field — saved on another device, loaded late — replaces the draft only while the draft still
 * equals the copy it followed last. After a save the stored value equals the draft again, so the
 * field follows the next copy (BUG-20261011-prep-field-draft-replaced-by-parent-copy;
 * `.howto/sync-state-from-late-props.md`). `same` compares values that are rebuilt on every render,
 * such as lists.
 */
export function useFieldDraft<T>(value: T, same: (a: T, b: T) => boolean = Object.is) {
  const [draft, setDraft] = useState(value);
  const followed = useRef(value);
  const sameRef = useRef(same);
  sameRef.current = same;

  useEffect(() => {
    const previous = followed.current;
    if (sameRef.current(value, previous)) return;
    followed.current = value;
    setDraft(current => (sameRef.current(current, previous) ? value : current));
  }, [value]);

  return [draft, setDraft] as const;
}
