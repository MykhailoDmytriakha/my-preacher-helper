// Route-level loading UI. Rendered instantly by the App Router on navigation,
// before the client page/data are ready, so a click gives immediate feedback.
// Mirrors the in-page loading skeleton in groups/[id]/page.tsx.
export default function Loading() {
  return (
    <div className="space-y-4">
      {[1, 2, 3].map((index) => (
        <div
          key={index}
          className="h-24 animate-pulse rounded-xl border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800"
        />
      ))}
    </div>
  );
}
