export const DashboardStatsSkeleton = () => {
  return (
    <div className="grid grid-cols-2 gap-2.5 sm:gap-4 lg:grid-cols-4 animate-pulse" data-testid="dashboard-stats-skeleton">
      {[1, 2, 3, 4].map((i) => (
        <div key={i} className="bg-white dark:bg-gray-800 rounded-lg shadow border border-gray-200 dark:border-gray-700 p-3 sm:p-5">
          <div className="flex flex-wrap items-center gap-3 sm:gap-4">
            <div className="rounded-full bg-gray-200 dark:bg-gray-700 p-2 sm:p-3 h-9 w-9 sm:h-12 sm:w-12 flex-shrink-0"></div>
            <div className="min-w-0 flex-1 basis-36 space-y-2">
              <div className="h-3 sm:h-4 bg-gray-200 dark:bg-gray-700 rounded w-24 max-w-full"></div>
              <div className="h-6 sm:h-8 bg-gray-200 dark:bg-gray-700 rounded w-12 max-w-full"></div>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
};
