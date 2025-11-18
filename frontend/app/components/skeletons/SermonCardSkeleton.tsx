export const SermonCardSkeleton = () => {
  return (
    <div className="flex flex-col bg-gray-50 dark:bg-gray-900 rounded-lg shadow border border-gray-200 dark:border-gray-700 h-full animate-pulse">
      <div className="p-4 sm:p-5 flex flex-col flex-grow">
        {/* Header */}
        <div className="flex items-start justify-between gap-2 mb-3">
          <div className="h-6 bg-gray-200 dark:bg-gray-800 rounded w-3/4"></div>
          <div className="h-8 w-8 bg-gray-200 dark:bg-gray-800 rounded-full"></div>
        </div>
        
        {/* Verse */}
        <div className="h-4 bg-gray-200 dark:bg-gray-800 rounded w-1/2 mb-4"></div>

        {/* Footer tags */}
        <div className="flex items-center mt-auto gap-2">
          <div className="h-4 w-16 bg-gray-200 dark:bg-gray-800 rounded"></div>
          <div className="h-5 w-20 bg-gray-200 dark:bg-gray-800 rounded-full"></div>
        </div>
      </div>

      {/* Bottom bar */}
      <div className="p-3 sm:p-4 border-t border-gray-200 dark:border-gray-700 flex flex-col gap-3 bg-gray-50 dark:bg-gray-900">
        <div className="h-4 w-24 bg-gray-200 dark:bg-gray-800 rounded"></div>
        <div className="flex justify-between gap-2">
          <div className="h-9 w-24 bg-gray-200 dark:bg-gray-800 rounded"></div>
          <div className="flex gap-2">
            <div className="h-9 w-9 bg-gray-200 dark:bg-gray-800 rounded"></div>
            <div className="h-9 w-9 bg-gray-200 dark:bg-gray-800 rounded"></div>
          </div>
        </div>
      </div>
    </div>
  );
};

