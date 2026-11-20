/** The look of a point's sub-point controls: the sub-point list (sidebar, classic outline) and the structure page's lanes. */
const SUB_POINT_LABEL_CLASS = "text-slate-600 dark:text-blue-50/90";
const DRAG_HANDLE_ICON_CLASS = "h-3 w-3 text-slate-400 dark:text-blue-100/70";
const SECONDARY_ICON_BUTTON_CLASS = "p-0.5 text-gray-400 hover:text-gray-600 dark:text-gray-500";
const SIDEBAR_CANCEL_ICON_BTN_CLASS = "p-0.5 text-blue-200/70 hover:text-white";

/** The sub-point controls' look, shared with the structure page's lanes (`ThoughtLanes`). */
export const getSubPointStyles = (isSidebar: boolean) => ({
  labelColorClass: isSidebar ? "text-blue-50/90 dark:text-blue-50/90" : SUB_POINT_LABEL_CLASS,
  dragHandleClass: isSidebar ? "h-3 w-3 text-blue-200/60" : DRAG_HANDLE_ICON_CLASS,
  bulletDotClass: isSidebar
    ? "w-1.5 h-1.5 rounded-full bg-blue-100/80 flex-shrink-0 shadow-sm"
    : "w-1.5 h-1.5 rounded-full bg-slate-400 dark:bg-blue-100/75 flex-shrink-0 shadow-sm dark:shadow-blue-950/20",
  editButtonClass: isSidebar
    ? "p-0.5 text-blue-200/60 hover:text-white dark:text-blue-200/60 dark:hover:text-white"
    : "p-0.5 text-slate-400 hover:text-slate-600 dark:text-blue-100/45 dark:hover:text-blue-50",
  deleteButtonClass: isSidebar
    ? "p-0.5 text-blue-200/60 hover:text-red-300 dark:text-blue-200/60 dark:hover:text-red-300"
    : "p-0.5 text-slate-400 hover:text-red-500 dark:text-blue-100/45 dark:hover:text-red-200",
  itemClass: isSidebar
    ? "group/sp flex min-w-0 flex-col rounded-md px-1.5 py-0.5 text-[13px] font-medium leading-5 text-blue-50/90 dark:text-blue-50/90 transition-colors hover:bg-white/10"
    : "group/sp flex min-w-0 flex-col rounded-lg px-2 py-1.5 transition-colors hover:bg-slate-100/80 dark:hover:bg-white/10",
  inputClass: isSidebar
    ? "flex-1 px-1.5 py-0.5 text-[13px] bg-blue-950/60 border border-blue-400/30 text-white placeholder-blue-200/50 rounded focus:outline-none focus:ring-1 focus:ring-blue-300 min-w-0"
    : "flex-1 px-2 py-0.5 text-sm bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 rounded border border-gray-300 dark:border-gray-500 focus:outline-none focus:ring-1 focus:ring-blue-400 min-w-0",
  confirmDeleteWrapperClass: isSidebar
    ? "flex flex-col gap-1.5 py-1.5 px-2 mt-1 rounded bg-blue-950/40 border border-blue-400/20 text-xs"
    : "flex items-center gap-2 py-1.5 px-2 mt-1 rounded bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800/50 text-xs",
  confirmDeleteMessageClass: isSidebar ? "text-blue-100 flex-1" : "text-red-600 dark:text-red-400 flex-1",
  confirmDeleteBtnClass: isSidebar
    ? "px-2 py-0.5 rounded bg-red-500/80 hover:bg-red-500 text-white font-medium transition-colors"
    : "px-2 py-0.5 rounded bg-red-100 hover:bg-red-200 dark:bg-red-800/40 dark:hover:bg-red-800/60 text-red-700 dark:text-red-300 font-medium transition-colors",
  confirmDeleteCancelBtnClass: isSidebar ? SIDEBAR_CANCEL_ICON_BTN_CLASS : SECONDARY_ICON_BUTTON_CLASS,
  addButtonClass: isSidebar
    ? "flex items-center gap-1 pl-1.5 py-0.5 text-xs font-medium text-blue-200/70 hover:text-white transition-colors rounded focus:outline-none focus-visible:ring-1 focus-visible:ring-white/50"
    : "flex items-center gap-1 pl-1.5 py-0.5 text-xs font-medium text-slate-400 dark:text-slate-500 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors rounded focus:outline-none focus-visible:ring-1 focus-visible:ring-indigo-500/50",
  saveBtnClass: isSidebar ? "p-0.5 text-green-300 hover:text-green-200" : "p-0.5 text-green-600 hover:text-green-700 dark:text-green-400",
  cancelBtnClass: isSidebar ? SIDEBAR_CANCEL_ICON_BTN_CLASS : SECONDARY_ICON_BUTTON_CLASS,
  confirmDeleteRowClass: isSidebar ? "flex items-center justify-end gap-2" : "flex items-center gap-2",
  cloneItemClass: isSidebar
    ? "flex items-center gap-2 py-1 px-2 rounded-md bg-blue-900 shadow-xl ring-1 ring-white/20 text-[13px]"
    : "flex items-center gap-2 py-1 px-2 rounded-md bg-white dark:bg-slate-800 shadow-lg ring-1 ring-blue-400/50 text-sm",
  labelFontClass: isSidebar ? "text-[13px]" : "text-sm",
});
