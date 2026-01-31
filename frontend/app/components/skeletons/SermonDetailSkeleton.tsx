
export const SermonDetailSkeleton = () => {
    return (
        <div data-testid="sermon-detail-skeleton" className="animate-pulse space-y-6">
            {/* Header Skeleton */}
            <div className="flex flex-col sm:flex-row justify-between items-start gap-4">
                <div className="space-y-3 w-full sm:w-2/3">
                    {/* Title */}
                    <div className="h-8 sm:h-10 bg-gray-200 dark:bg-gray-800 rounded-md w-3/4"></div>
                    {/* Verse */}
                    <div className="h-5 bg-gray-200 dark:bg-gray-800 rounded-md w-1/2"></div>
                    {/* Date & Tags */}
                    <div className="flex gap-2 pt-1">
                        <div className="h-6 w-24 bg-gray-200 dark:bg-gray-800 rounded-full"></div>
                        <div className="h-6 w-20 bg-gray-200 dark:bg-gray-800 rounded-full"></div>
                    </div>
                </div>

                {/* Actions Placeholder */}
                <div className="flex gap-2">
                    <div className="h-10 w-24 bg-gray-200 dark:bg-gray-800 rounded-md"></div>
                </div>
            </div>

            {/* Tabs/Mode Switcher Skeleton */}
            <div className="border-b border-gray-200 dark:border-gray-700 pb-1">
                <div className="flex space-x-6">
                    <div className="h-8 w-24 bg-gray-200 dark:bg-gray-800 rounded mb-[-1px]"></div>
                    <div className="h-8 w-24 bg-gray-200 dark:bg-gray-800 rounded mb-[-1px]"></div>
                </div>
            </div>

            {/* Main Content Skeleton */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* Left Column (Main Content) */}
                <div className="lg:col-span-2 space-y-6">
                    {/* Section 1 */}
                    <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6 space-y-4">
                        <div className="h-6 w-1/3 bg-gray-200 dark:bg-gray-700 rounded"></div>
                        <div className="space-y-2">
                            <div className="h-4 w-full bg-gray-200 dark:bg-gray-700 rounded"></div>
                            <div className="h-4 w-5/6 bg-gray-200 dark:bg-gray-700 rounded"></div>
                            <div className="h-4 w-4/6 bg-gray-200 dark:bg-gray-700 rounded"></div>
                        </div>
                    </div>

                    {/* Section 2 */}
                    <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6 space-y-4">
                        <div className="h-6 w-1/4 bg-gray-200 dark:bg-gray-700 rounded"></div>
                        <div className="space-y-2">
                            <div className="h-4 w-full bg-gray-200 dark:bg-gray-700 rounded"></div>
                            <div className="h-4 w-11/12 bg-gray-200 dark:bg-gray-700 rounded"></div>
                        </div>
                    </div>
                </div>

                {/* Right Column (Sidebar) */}
                <div className="space-y-6">
                    <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6 h-64">
                        <div className="h-6 w-1/2 bg-gray-200 dark:bg-gray-700 rounded mb-4"></div>
                        <div className="h-32 bg-gray-200 dark:bg-gray-700 rounded"></div>
                    </div>
                </div>
            </div>
        </div>
    );
};
