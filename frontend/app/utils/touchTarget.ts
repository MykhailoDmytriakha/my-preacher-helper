/**
 * A PRESSABLE AREA OF 44 × 44 PX AROUND A SMALL CONTROL (Apple HIG; WCAG 2.5.5). The control looks the same; a transparent
 * layer around it takes the finger (Codex UX review, 04.11: a 20 px arrow on a Studies card let a near miss open the note
 * instead of folding it). The class makes the control `relative`. Keep neighbours as far apart as the layer grows — 12 px
 * for `compact` — or the overlap goes to the one drawn later.
 */
export const TOUCH_AREA = {
  /** A 20 px control: 12 px on every side. */
  small: 'relative after:absolute after:-inset-3',
  /** A 32 px control: 6 px on every side. */
  compact: 'relative after:absolute after:-inset-1.5',
  /** A short text button, about 28 px high: 8 px above and below. */
  short: 'relative after:absolute after:inset-x-0 after:-inset-y-2',
} as const;
