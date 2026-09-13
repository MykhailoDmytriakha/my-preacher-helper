/**
 * The grouped-form look, in one place.
 *
 * Every form that lives in a banded dialog (see `FormDialog`'s footer-shaped variant)
 * draws the same thing: labelled groups, one rounded card per group, hairline dividers
 * between its rows. These strings were copied into each form that wanted the look, which
 * is how the create and edit windows for a single sermon ended up different from each
 * other. A pure module, so Tailwind sees complete literals and nothing has to be built
 * at runtime.
 */

/** One rounded card per group, hairline dividers between its rows. */
export const GROUP_CARD =
  'rounded-2xl border border-gray-200 bg-white divide-y divide-gray-200 dark:border-gray-700 dark:bg-gray-800/60 dark:divide-gray-700';

/** The small uppercase caption that names a group, above its card. */
export const GROUP_TITLE =
  'px-1 pb-2 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400';

/** One field inside a card; the card's divider draws the line between rows. */
export const FIELD_ROW = 'p-4';

export const FIELD_LABEL = 'block text-sm font-medium text-gray-700 dark:text-gray-200';

export const FIELD_INPUT =
  'mt-1 block w-full rounded-xl border border-gray-300 bg-white p-3 text-gray-900 transition focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/30 disabled:opacity-60 dark:border-gray-700 dark:bg-gray-700 dark:text-white';

/** The hint line under a group's card, in the caller's own words. */
export const GROUP_HINT = 'px-1 pt-2 text-xs text-gray-500 dark:text-gray-400';
