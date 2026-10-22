const BAR = 'rounded bg-gray-200 dark:bg-gray-800';

/** Grey lines where a paragraph of the note's text will stand, at the text's own line height. */
function TextLines({ widths }: { widths: string[] }) {
  return (
    <div className="space-y-[10px]">
      {widths.map((width, index) => <div key={index} className={`h-4 ${width} ${BAR}`} />)}
    </div>
  );
}

/**
 * THE NOTE'S SILHOUETTE WHILE IT OPENS: its header, the side panel on a wide screen and grey lines where
 * the text will be, where the opened note puts them, so the text comes in where the eye already is. The
 * route shows it while the page's code comes (`studies/[id]/loading.tsx`), the page while the notes come
 * from the device — in place of a green spinning arrow that read as "something is refreshing" (the owner,
 * 2026-10-21, BUG-20261021-note-opens-with-spinner). CSS breakpoints only, the page's own: `sm` the header's
 * roomy rows, `lg` the panel, `xl` the title between the controls. It carries the note's workspace mark, so
 * a wide screen gives it the note's own margins and height (`globals.css`, `[data-note-workspace]`).
 */
export function NoteDetailSkeleton() {
  return (
    <div data-note-workspace data-testid="note-detail-skeleton" aria-busy="true" className="-m-4 flex min-h-screen flex-col bg-white dark:bg-gray-900 md:-m-6 lg:-m-8">
      <div className="animate-pulse border-b border-gray-200 px-3 py-1.5 dark:border-gray-800 sm:px-6 sm:py-3">
        <div className="flex h-11 items-center justify-between gap-4 sm:h-9">
          <div className="flex items-center gap-3">
            <div className={`hidden h-5 w-5 sm:block ${BAR}`} />
            <div className={`h-4 w-16 ${BAR}`} />
            <div className={`h-6 w-20 rounded-full ${BAR}`} />
          </div>
          <div className={`hidden h-7 w-1/3 max-w-md xl:block ${BAR}`} />
          <div className="flex items-center gap-2">
            <div className={`h-9 w-9 rounded-lg ${BAR}`} />
            <div className={`h-9 w-9 rounded-lg ${BAR}`} />
          </div>
        </div>
        <div className="flex items-center gap-3 py-2 sm:pb-0 sm:pt-3 xl:hidden">
          <div className={`h-6 w-6 shrink-0 sm:hidden ${BAR}`} />
          <div className={`mx-auto h-7 w-3/5 sm:mx-0 sm:w-2/5 ${BAR}`} />
        </div>
      </div>
      <div className="flex flex-1 animate-pulse">
        <div className="hidden w-[272px] shrink-0 flex-col gap-4 border-r border-gray-200 bg-gray-50 px-3.5 pt-4 dark:border-gray-800 dark:bg-gray-900/40 lg:flex">
          <div className={`h-3 w-28 ${BAR}`} />
          <div className="space-y-2">
            <div className={`h-3 w-24 ${BAR}`} />
            <div className={`h-3 w-44 ${BAR}`} />
          </div>
          <div className="space-y-3 border-t border-gray-200 pt-4 dark:border-gray-800">
            <div className={`h-4 w-32 ${BAR}`} />
            <div className={`h-6 w-20 rounded-full ${BAR}`} />
          </div>
          <div className="border-t border-gray-200 pt-4 dark:border-gray-800">
            <div className={`h-4 w-16 ${BAR}`} />
          </div>
        </div>
        <div className="min-w-0 flex-1 space-y-6 px-4 py-8 md:px-8 md:py-10">
          <TextLines widths={['w-full', 'w-11/12', 'w-4/5']} />
          <TextLines widths={['w-full', 'w-5/6', 'w-full', 'w-2/3']} />
          <TextLines widths={['w-11/12', 'w-3/4']} />
        </div>
      </div>
    </div>
  );
}
