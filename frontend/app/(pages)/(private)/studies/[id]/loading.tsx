// Route-level loading UI. Rendered instantly by the App Router on navigation,
// before the client page/data are ready, so a click gives immediate feedback.
// Mirrors the in-page loading spinner in studies/[id]/page.tsx.
export default function Loading() {
  return (
    <div className="flex items-center justify-center p-12">
      <svg
        className="h-6 w-6 animate-spin text-emerald-600"
        xmlns="http://www.w3.org/2000/svg"
        fill="none"
        viewBox="0 0 24 24"
        aria-hidden="true"
      >
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
        <path
          className="opacity-75"
          fill="currentColor"
          d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
        />
      </svg>
    </div>
  );
}
