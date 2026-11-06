/** The existing group placeholders, shared by route and document loading. */
export function GroupDetailSkeletonCards({ ariaHidden = false }: { ariaHidden?: boolean }) {
  return <>{[1, 2, 3].map(index => <div key={index} aria-hidden={ariaHidden || undefined}
    className="h-24 animate-pulse rounded-xl border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800" />)}</>;
}

export function GroupDetailSkeleton() {
  return <div className="space-y-4" data-page-loading=""><GroupDetailSkeletonCards /></div>;
}
