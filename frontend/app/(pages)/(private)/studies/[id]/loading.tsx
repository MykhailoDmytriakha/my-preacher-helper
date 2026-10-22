import { NoteDetailSkeleton } from '@/components/skeletons/NoteDetailSkeleton';

// Route-level loading UI. Rendered instantly by the App Router on navigation,
// before the client page/data are ready, so a click gives immediate feedback.
// The same silhouette the page shows while its notes come (studies/[id]/page.tsx).
export default function Loading() {
  return <NoteDetailSkeleton />;
}
