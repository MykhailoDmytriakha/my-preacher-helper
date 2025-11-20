export function SeriesCardSkeleton() {
  return (
    <div className="animate-pulse rounded-xl border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-800 dark:bg-gray-900/60">
      <div className="flex justify-between items-start">
        <div className="h-6 w-32 rounded bg-gray-200 dark:bg-gray-700" />
        <div className="h-5 w-16 rounded-full bg-gray-200 dark:bg-gray-700" />
      </div>
      <div className="mt-3 h-4 w-48 rounded bg-gray-200 dark:bg-gray-700" />
      <div className="mt-2 h-4 w-36 rounded bg-gray-200 dark:bg-gray-700" />
      <div className="mt-6 space-y-2">
        <div className="h-3 w-full rounded bg-gray-200 dark:bg-gray-700" />
        <div className="h-3 w-5/6 rounded bg-gray-200 dark:bg-gray-700" />
      </div>
      <div className="mt-5 flex gap-3">
        <div className="h-8 w-20 rounded-full bg-gray-200 dark:bg-gray-700" />
        <div className="h-8 w-24 rounded-full bg-gray-200 dark:bg-gray-700" />
      </div>
    </div>
  );
}

export function SeriesGridSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: count }).map((_, idx) => (
        <SeriesCardSkeleton key={idx} />
      ))}
    </div>
  );
}
