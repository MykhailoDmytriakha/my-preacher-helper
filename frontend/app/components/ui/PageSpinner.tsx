/** The whole-page spinner of app start: every gate before a page shows this same markup, so passing between them changes no design. */
export function PageSpinner() {
  return (
    <div className="min-h-screen bg-white dark:bg-gray-900 flex items-center justify-center">
      <div className="w-12 h-12 border-t-2 border-b-2 border-blue-500 rounded-full animate-spin" data-testid="loading-spinner"></div>
    </div>
  );
}
