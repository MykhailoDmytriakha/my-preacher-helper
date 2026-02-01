export const DashboardStatsSkeleton = () => {
  return (
    <div className="grid grid-cols-2 gap-2.5 sm:gap-4 lg:grid-cols-4 animate-pulse" data-testid="dashboard-stats-skeleton">
      {[1, 2, 3, 4].map((i) => (
        <div key={i} className="bg-white dark:bg-gray-800 rounded-lg shadow border border-gray-200 dark:border-gray-700 p-3 sm:p-5">
          <div className="flex items-center">
            <div className="rounded-full bg-gray-200 dark:bg-gray-700 p-2 sm:p-3 mr-3 sm:mr-4 h-10 w-10 sm:h-12 sm:w-12 flex-shrink-0"></div>
            <div className="flex-grow space-y-2">
              <div className="h-3 sm:h-4 bg-gray-200 dark:bg-gray-700 rounded w-24"></div>
              <div className="h-6 sm:h-8 bg-gray-200 dark:bg-gray-700 rounded w-12"></div>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
};
