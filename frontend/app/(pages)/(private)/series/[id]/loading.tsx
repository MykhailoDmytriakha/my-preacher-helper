import { SeriesDetailSkeleton } from '@/components/skeletons/SeriesDetailSkeleton';

// Route-level loading UI. Rendered instantly by the App Router on navigation,
// before the client page/data are ready, so a click gives immediate feedback.
export default function Loading() {
  return <SeriesDetailSkeleton />;
}
