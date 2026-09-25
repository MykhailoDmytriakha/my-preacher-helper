'use client';

import { useEffect, useRef } from 'react';

import { useBufferedText } from './useBufferedText';

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
 * The field owns only text the document has not echoed yet. Once the document owns
 * those keystrokes, its next value is safe to display even while the field has focus.
 * Keeping a second stale copy after that point would bypass the engine's conflict baseline.
 *
 * Written here rather than in the council screens because any section editing text held in a
 * cache needs the same thing.
 */
type LiveTextInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'> & {
  value: string;
  onChange: (next: string) => void;
};

export function LiveTextInput({ value, onChange, ...rest }: LiveTextInputProps) {
  const { draft, change } = useBufferedText(value, onChange);

  return (
    <input
      {...rest}
      value={draft}
      onChange={(event) => change(event.target.value)}
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
export function LiveTextArea({ value, onChange, ...rest }: LiveTextAreaProps) {
  const { draft, change } = useBufferedText(value, onChange);
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
      className={`resize-none overflow-hidden ${rest.className ?? ''}`}
    />
  );
}
