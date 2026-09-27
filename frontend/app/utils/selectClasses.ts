export type SelectSize = 'sm' | 'md';

/**
 * Where the dropdown sits. `field` is a form field on the page background; `muted` is a
 * control inside a panel that already has its own light plate (the filter popovers on the
 * sermons and prayers pages).
 */
export type SelectTone = 'field' | 'muted';

/**
 * The focus ring follows the section the control belongs to. These are PROPS and not
 * something a caller appends to `className`, for the same reason `Chip` makes weight a
 * prop: Tailwind decides which of two same-specificity rules wins by the order it wrote
 * them into the stylesheet, not by the order they appear in the attribute — so a caller
 * passing `bg-gray-50` next to this module's `bg-white` would lose silently, some of the
 * time, and only on the built stylesheet.
 */
export type SelectAccent = 'emerald' | 'blue' | 'rose' | 'amber' | 'neutral';

/**
 * Everything a dropdown is before it picks a size, a tone or an accent.
 *
 * `appearance-none` is the load-bearing part: the arrow every browser draws for a native
 * `<select>` sits at its own distance from the right edge, so two filters side by side
 * never line up — and a filter sized to its longest option leaves its short label stranded
 * far from that arrow. The arrow is ours instead, drawn by `Select`, and the right padding
 * below is the seat reserved for it.
 */
export const SELECT_SHAPE_CLASSES =
  'w-full min-w-0 appearance-none truncate rounded-lg border shadow-sm transition focus:outline-none focus:ring-2 disabled:cursor-not-allowed disabled:opacity-60';

/**
 * The right padding is the arrow's seat. `sm` seats a 16px chevron inset 10px, `md` a 20px
 * one inset 12px — change one and change the matching inset in `SELECT_CHEVRON_CLASSES`,
 * or the longest option will run under the arrow.
 */
export const SELECT_SIZE_CLASSES: Record<SelectSize, string> = {
  sm: 'h-9 pl-3 pr-9 text-sm',
  md: 'h-11 pl-3.5 pr-11 text-sm',
};

export const SELECT_CHEVRON_CLASSES: Record<SelectSize, string> = {
  sm: 'right-2.5 h-4 w-4',
  md: 'right-3 h-5 w-5',
};

export const SELECT_TONE_CLASSES: Record<SelectTone, string> = {
  field: 'border-gray-200 bg-white text-gray-900 dark:border-gray-700 dark:bg-gray-800 dark:text-white',
  muted:
    'border-gray-200 bg-gray-50 text-gray-900 hover:bg-gray-100 dark:border-gray-700 dark:bg-gray-900/50 dark:text-gray-100 dark:hover:bg-gray-800',
};

/** Literal strings on purpose: Tailwind's compiler cannot see a class built at runtime. */
export const SELECT_ACCENT_CLASSES: Record<SelectAccent, string> = {
  emerald: 'focus:border-emerald-500 focus:ring-emerald-200 dark:focus:ring-emerald-900/40',
  blue: 'focus:border-blue-500 focus:ring-blue-200 dark:focus:ring-blue-900/40',
  rose: 'focus:border-rose-500 focus:ring-rose-200 dark:focus:ring-rose-900/40',
  amber: 'focus:border-amber-500 focus:ring-amber-200 dark:focus:ring-amber-900/40',
  neutral: 'focus:border-gray-400 focus:ring-gray-200 dark:focus:ring-gray-700',
};

export function buildSelectClasses(
  size: SelectSize,
  tone: SelectTone,
  accent: SelectAccent,
  className?: string,
): string {
  return [
    SELECT_SHAPE_CLASSES,
    SELECT_SIZE_CLASSES[size],
    SELECT_TONE_CLASSES[tone],
    SELECT_ACCENT_CLASSES[accent],
    className,
  ]
    .filter(Boolean)
    .join(' ');
}
