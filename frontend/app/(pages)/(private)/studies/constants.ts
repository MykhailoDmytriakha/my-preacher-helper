export const STUDIES_INPUT_SHARED_CLASSES =
  'rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-200 dark:border-gray-700 dark:bg-gray-900 dark:text-white';

/**
 * Returns a dynamic Tailwind max-width class based on content length
 */
export const getNoteModalWidth = (contentLength: number): string => {
  if (contentLength > 2000) return 'max-w-5xl';
  if (contentLength > 1000) return 'max-w-4xl';
  if (contentLength > 500) return 'max-w-3xl';
  return 'max-w-2xl';
};
