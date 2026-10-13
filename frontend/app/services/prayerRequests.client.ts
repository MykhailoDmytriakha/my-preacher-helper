/**
 * Prayer requests are read and written only through the data engine (engineOwnedCollections.ts);
 * what stays here is the names of a prayer's revision parts.
 */

/**
 * Independently edited parts of a prayer request. Kept apart so marking one
 * answered, or logging an update, never collides with someone editing the text —
 * false conflicts teach people to click through the dialog, which is worse than
 * having none.
 */
export const PRAYER_CORE_AGGREGATE = 'core';
export const PRAYER_STATUS_AGGREGATE = 'status';
export const PRAYER_UPDATES_AGGREGATE = 'updates';
