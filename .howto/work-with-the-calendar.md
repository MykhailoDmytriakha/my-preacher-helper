when: calendar · put something on the calendar · add a kind to the calendar · new calendar section · CalendarEntry · calendarEntries · calendarKinds · CALENDAR_KIND_STYLE · day cell dots · preach date shifts a day · note on the wrong day · date off by one · UTC midnight · YYYY-MM-DD · toDateOnlyKey · toLocalDateOnlyKey · parseDateOnlyAsLocalDate · createdAt on the calendar · entriesByDate · kindsByDate · entriesInMonth · eventsByDate · viewedMonth · currentMonth · selectedDate · DatePickerField · week starts on Monday · first day of week · weekStartsOn · weekStart.ts · input type date · DayPicker · react-day-picker · selected day invisible in dark mode · rdp-selected · rdp-day_button · same thing twice on the calendar · календарь · добавить на календарь · дата съехала на день · заметка не в тот день · неделя с понедельника · выбор даты · выбранный день не виден в тёмной теме · точки в клетке дня · дважды на календаре

# Put something on the calendar

Every source is translated once into a `CalendarEntry` in `frontend/app/utils/calendarEntries.ts` (`sermonEntries`, `groupEntries`, `councilEntries`, `noteEntries`, `prayerEntries`); what each kind looks like — icon, dot, legend, date badge, translation keys — is one line of `CALENDAR_KIND_STYLE` in `frontend/app/components/calendar/calendarKinds.tsx`. A new kind is a name in `CALENDAR_KINDS`, a builder and a style line — never a pass through the day cell, the card, the agenda and the filters.

## How

- The calendar speaks one date form: a `YYYY-MM-DD` string. Normalize at the boundary; the server writes preach dates through `toDateOnlyKey` (`frontend/app/api/repositories/sermons.repository.ts`).
- A chosen day (preach date, group meeting, council) → `toDateOnlyKey`: it keeps the stored `YYYY-MM-DD` prefix, which is the day the person picked. A clock stamp (`createdAt`, `updatedAt`, `answeredAt`) → `toLocalDateOnlyKey`, the local day of that instant; otherwise evening work west of UTC lands on tomorrow. Back to a `Date` → `parseDateOnlyAsLocalDate`, never `new Date('YYYY-MM-DD')`, which is UTC midnight. All in `frontend/app/utils/dateOnly.ts`.
- A thing with two stamps (note written/updated, prayer brought/answered) shows one card per day; when both fall on one day the first event keeps it. Only the second appearance carries a status chip (`updated`, `answered`), which says why it is there twice. An answer counts only while the prayer still stands answered.
- Views come from one pipeline: the page concatenates the builders' output, then `entriesByDate`, `kindsByDate`, `entriesInMonth`, `countByKind`. Exception: the analytics view and the planned/preached month summary still reduce `sermon.preachDates` themselves in `frontend/app/(pages)/(private)/calendar/page.tsx` — keep them on `toDateOnlyKey` too.
- The month on screen is not the clicked day: `currentMonth` and `selectedDate` are separate state, and children get `currentMonth` + `onMonthChange` (`PreachCalendar.tsx`, DayPicker `month`).
- A date input goes through `DatePickerField` (`frontend/app/components/ui/DatePickerField.tsx`, value and `onChange` in `YYYY-MM-DD`). It honours the person's week start via `getWeekStartsOn(settings.firstDayOfWeek)` (`frontend/app/utils/weekStart.ts`: sunday by default → 0, monday → 1). A native `input type="date"` popup cannot follow an app-level week start, mobile included.
- react-day-picker v9: the selected state sits on the cell (`.rdp-selected`), the visible circle is its child button. Style `.rdp-selected .rdp-day_button`; the legacy `.rdp-day_selected` alone does not reach it. Check computed colours in dark mode (`PreachCalendar.tsx` and `DatePickerField.tsx` both carry the rule).

## Traps

- Council dates are still native `input type="date"` (`care/council/page.tsx`, `care/council/[id]/page.tsx`), so those popups ignore a Monday week start.

## Why

- 2026-02-10: preach dates drifted a day between markers, list and analytics — hence one date form and one pipeline.
- The calendar first carried sermons and groups as two types with a `kind === 'sermon' ? … : …` in every view; a third kind would have nested every ternary, so the sources became one entry shape.
- 2026-05-10: the selected day vanished in dark mode because only the v8 class was styled.

See also: `.howto/resolve-locale-and-month-name.md` · `.howto/format-scripture-reference.md`
