'use client';

import { useEffect, useRef, useState } from 'react';

import type { InputHTMLAttributes, TextareaHTMLAttributes } from 'react';

/**
 * A TEXT FIELD THAT KEEPS WHAT IS BEING TYPED, even when the value behind it arrives late.
 *
 * A plain controlled input takes its displayed text from the store on every render. That works
 * while the store answers instantly; it loses letters as soon as the value travels — a React
 * Query cache written through an updater, a document saved a moment later, a background read
 * that lands mid-sentence. Typing quickly then produces a field that keeps only the last
 * character, and a question typed and left alone can vanish a second later when an older copy
 * arrives: nothing failed, the field simply went back in time.
 *
 * So the field owns its text while the person is in it, and follows the store when they are not.
 * Every keystroke still goes outward at once, so nothing waits for a blur to be saved — what
 * changes is only which copy is allowed to paint the field.
 *
 * Written here rather than in the council screens because any section editing text held in a
 * cache needs the same thing.
 */
function useLiveDraft(value: string, onChange: (next: string) => void) {
  const [draft, setDraft] = useState(value);
  const editing = useRef(false);
  const latest = useRef(value);
  latest.current = value;

  // While the caret is in the field its own text wins; outside it, the store is the truth.
  useEffect(() => {
    if (!editing.current) setDraft(value);
  }, [value]);

  return {
    draft,
    change: (next: string) => {
      setDraft(next);
      onChange(next);
    },
    enter: () => {
      editing.current = true;
    },
    leave: () => {
      editing.current = false;
      // A change that arrived from elsewhere while the caret was here was held back; now that the
      // field is free it takes it, instead of showing a stale line until the next edit.
      setDraft(latest.current);
    },
  };
}

type LiveTextInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'> & {
  value: string;
  onChange: (next: string) => void;
};

export function LiveTextInput({ value, onChange, onFocus, onBlur, ...rest }: LiveTextInputProps) {
  const { draft, change, enter, leave } = useLiveDraft(value, onChange);

  return (
    <input
      {...rest}
      value={draft}
      onChange={(event) => change(event.target.value)}
      onFocus={(event) => {
        enter();
        onFocus?.(event);
      }}
      onBlur={(event) => {
        leave();
        onBlur?.(event);
      }}
    />
  );
}

type LiveTextAreaProps = Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'value' | 'onChange'> & {
  value: string;
  onChange: (next: string) => void;
};

/**
 * THE SAME FIELD FOR TEXT THAT DOES NOT FIT ON ONE LINE. An answer to a brother's question is
 * often a sentence with a reason attached, and a one-line box hides everything but its tail while
 * it is being written. This one grows with what is in it — no scrollbar inside a field three
 * words long, no truncation of a long one — and shrinks again when the text is cut.
 */
export function LiveTextArea({ value, onChange, onFocus, onBlur, ...rest }: LiveTextAreaProps) {
  const { draft, change, enter, leave } = useLiveDraft(value, onChange);
  const field = useRef<HTMLTextAreaElement | null>(null);

  const fit = (element: HTMLTextAreaElement | null) => {
    if (!element) return;
    element.style.height = 'auto';
    element.style.height = `${element.scrollHeight}px`;
  };

  // On mount and whenever the text changes from outside — a read landing, another device.
  useEffect(() => fit(field.current), [draft]);

  /*
   * And whenever the field itself changes width. Turning a tablet makes the same text need one
   * line more; without this it keeps the height it had and hides the last line behind
   * `overflow-hidden`, with no scrollbar to reveal that anything is missing.
   */
  useEffect(() => {
    const element = field.current;
    if (!element || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => fit(element));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return (
    <textarea
      {...rest}
      ref={field}
      rows={1}
      value={draft}
      onChange={(event) => {
        change(event.target.value);
        fit(event.target);
      }}
      onFocus={(event) => {
        enter();
        onFocus?.(event);
      }}
      onBlur={(event) => {
        leave();
        onBlur?.(event);
      }}
      className={`resize-none overflow-hidden ${rest.className ?? ''}`}
    />
  );
}
