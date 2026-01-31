import React from 'react';

interface StructurePageSkeletonProps {
    isFocusMode?: boolean;
}

export const StructurePageSkeleton = ({ isFocusMode = false }: StructurePageSkeletonProps) => {
    return (
        <div className="p-4 animate-pulse" data-testid="structure-skeleton">
            <div className="w-full">
                {/* Header Skeleton */}
                <div className="mb-4 space-y-4">
                    <div className="h-10 bg-gray-200 dark:bg-gray-800 rounded-md w-1/2 mx-auto"></div>

                    {/* FocusNav Skeleton */}
                    <div className="flex justify-center space-x-2">
                        <div className="h-10 w-32 bg-gray-200 dark:bg-gray-800 rounded-lg"></div>
                        <div className="h-10 w-32 bg-gray-200 dark:bg-gray-800 rounded-lg"></div>
                        <div className="h-10 w-32 bg-gray-200 dark:bg-gray-800 rounded-lg"></div>
                    </div>
                </div>

                {/* Ambiguous Section Skeleton */}
                <div className="mb-4">
                    <div className="h-12 bg-gray-100 dark:bg-gray-900 rounded-xl border border-dotted border-gray-300 dark:border-gray-700 w-full flex items-center px-4">
                        <div className="h-5 w-40 bg-gray-200 dark:bg-gray-800 rounded"></div>
                    </div>
                </div>

                {/* Columns Skeleton */}
                <div className={`${!isFocusMode ? 'grid grid-cols-1 md:grid-cols-3 gap-6' : 'flex flex-col'} w-full mt-8`}>
                    {/* Column 1 */}
                    <div className="space-y-4">
                        <div className="h-8 w-1/2 bg-gray-200 dark:bg-gray-800 rounded mb-4"></div>
                        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4 space-y-3 h-48">
                            <div className="h-4 w-full bg-gray-100 dark:bg-gray-700 rounded"></div>
                            <div className="h-4 w-5/6 bg-gray-100 dark:bg-gray-700 rounded"></div>
                            <div className="h-4 w-4/6 bg-gray-100 dark:bg-gray-700 rounded"></div>
                        </div>
                        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4 space-y-3 h-32">
                            <div className="h-4 w-full bg-gray-100 dark:bg-gray-700 rounded"></div>
                            <div className="h-4 w-3/4 bg-gray-100 dark:bg-gray-700 rounded"></div>
                        </div>
                    </div>

                    {/* Column 2 - Only in Grid mode or if it's the target column (for simplicity we show all 3 in Grid, 1 in Focus) */}
                    {!isFocusMode && (
                        <div className="space-y-4">
                            <div className="h-8 w-1/2 bg-gray-200 dark:bg-gray-800 rounded mb-4"></div>
                            <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4 space-y-3 h-64">
                                <div className="h-4 w-full bg-gray-100 dark:bg-gray-700 rounded"></div>
                                <div className="h-4 w-11/12 bg-gray-100 dark:bg-gray-700 rounded"></div>
                            </div>
                        </div>
                    )}

                    {/* Column 3 */}
                    {!isFocusMode && (
                        <div className="space-y-4">
                            <div className="h-8 w-1/2 bg-gray-200 dark:bg-gray-800 rounded mb-4"></div>
                            <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4 space-y-3 h-40">
                                <div className="h-4 w-full bg-gray-100 dark:bg-gray-700 rounded"></div>
                                <div className="h-4 w-5/6 bg-gray-100 dark:bg-gray-700 rounded"></div>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};
