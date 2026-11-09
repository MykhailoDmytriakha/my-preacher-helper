/**
 * Whether the app shows its edit-history entry points: the «История …» buttons that open earlier values a later
 * edit replaced (marks, titles, dates, tags, placements…).
 *
 * Off since 2026-11-09, by the owner's choice: 49 such buttons had landed on the Bible reader and the working
 * screens as plain links (BUG-20261109-edit-history-links-on-every-screen). History keeps being recorded on the
 * server; only the buttons are hidden until one designed place for it exists (FEATURE_CONCEPTS.md, «Где живёт
 * история правок»). Every component that opens edit history asks this one function, so bringing history back is
 * one change here; `__tests__/components/editHistoryHidden.test.tsx` keeps new history components on the switch.
 */
export function editHistoryShown(): boolean {
  return false;
}
