// Route-level loading UI. Rendered instantly by the App Router on navigation,
// before the client page/data are ready, so a click gives immediate feedback.
// Mirrors the in-page loading skeleton in prayers/[id]/page.tsx.
export default function Loading() {
  return (
    <div className="max-w-2xl mx-auto px-4 py-6 space-y-4">
      <div className="h-8 w-32 bg-gray-100 dark:bg-gray-800 rounded animate-pulse" />
      <div className="h-24 bg-gray-100 dark:bg-gray-800 rounded-xl animate-pulse" />
      <div className="h-16 bg-gray-100 dark:bg-gray-800 rounded-xl animate-pulse" />
    </div>
  );
}
