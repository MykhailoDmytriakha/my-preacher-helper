import { SermonDetailSkeleton } from "@/components/skeletons/SermonDetailSkeleton";

// Route-level loading UI. Rendered instantly by the App Router on navigation,
// before the heavy client page/data are ready, so a click gives immediate
// feedback instead of feeling like nothing happened.
export default function Loading() {
  return (
    <div className="space-y-4 sm:space-y-6 py-4 sm:py-8">
      <SermonDetailSkeleton />
    </div>
  );
}
