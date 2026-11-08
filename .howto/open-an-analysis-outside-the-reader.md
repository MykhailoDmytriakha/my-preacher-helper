when: open an analysis outside the reader · AnalysisEditor in Studies · analysis door · its other home · В Библии · Все разборы · перекрёсток разбора · analysis tab · analyses tab · open analysis in Studies · analysis opens in the note editor · analysis on another Bible · разбор в изучениях · вкладка разборы · открыть разбор не в Библии · разбор открылся как заметка · analysis on a phone · AnalysisPhone · AnalysisPhoneBar · usePhoneAnalysis · capsule ‹ › · bar hides on scroll · разбор на телефоне · шапка разбора · отступ слева в разборе · сообщение разбора не видно

# Open a passage's analysis outside the reader

The analysis screen (`components/bible/analysis/AnalysisEditor.tsx`) is a full-screen portal dialog: it can stand over any page, not only the reader. Studies does it (`studies/StudyAnalysisWindow.tsx`, the owner 02.11).

## How

1. Read the book text of the analysis's **own** Bible — `analysisBible(note, fallback)`: `note.analysis.bible`, then the reference's. Never the interface's or the reader's choice: the parts are word numbers in that text, and laid on another they stand on other words (BUG-20261030-analysis-other-bible-overwrite).
2. `fetchBookText(book, bible)`; a failure (offline, the book never kept) is said (`bible.loadError`) and nothing opens.
3. The book's marks: `useAnalysisBookMarks({ bible, bookId, text })` opens the book's one marks form. Only where no reader is mounted — over the reader the reader lends its own form (`useReaderMarks().analysisMarks`), and two forms of one book push each other out. Whether a stroke can be kept now is one rule for both, `marks/useMarksWriteGate.tsx`; away from the reader its `status` (the choice when marks changed on two devices) rides in `AnalysisMarks.status` and the editor shows it under its notices — without it a refused stroke is told to choose a version nowhere offered (Codex, 02.11).
4. Mount `AnalysisEditor` with `opening: { kind: 'open', id, editing }`, `backLabel` naming where the way back leads (the default says «К тексту», the reader's), `onOpenScreen` (a sermon made from it, the door below), and `door` — the analysis's other home (next section). Leave `onEditVerses` out: verses are chosen on the reader's text.
5. The editor keeps `analysis=<id>&mode=edit|view` in the current address while open (`analysisAddress.ts`, `useAnalysisAddress.ts`): opened over the page it is one step in history — Back closes it, its own way back takes the step (the owner, 03.11; `.howto/make-back-close-a-screen.md`); arrived at by an address it adds none. Reopen after a reload from the address once, when the list first answers, and only if the list this device holds has that analysis; otherwise say so (`studiesWorkspace.analysisNotHere`) and clear the address (`useStudyAnalysisOpening`). Do not wait for it: two Codex rounds (02.11) showed a late arrival opening over whatever the person had turned to, and a deleted one kept in the address for good — the person opens it from the list once it is there. Closing clears the address itself: the editor clears it only if it mounted, and a book that failed to load never mounts it.

## Its two homes — the crossroads (the owner, 03.11)

An analysis lives in two places: its passage in the Bible and the list of all analyses in Studies. Its screen's way back leads where the person came from (path); beside it, the `door` (`AnalysisDoor`, `AnalysisParts.tsx`) leads to the home the person did not come from (place) — a name in one word on a phone's bar.
- Over Studies' list: `{ home: 'bible', href: () => analysisPassageHref(note, { locale, from: <the address at the press> }) }` — the passage lit, the reader's way back named «← Разбор» (`wayBackKind` sees `analysis=` in a Studies address).
- Over the reader: `{ home: 'analyses', href: analysesListHref }` — `/studies?tab=analyses&at=<id>`; Studies brings that card into sight, lights it for a moment and takes `at` out of the address at once (`useListArrival`).
- A door goes to the place, it does not move the screen: `onOpenScreen` after `note.flush()`, the screen closes with the page, and its step in history stays — Back from the other home reopens the analysis where it was. The address is asked at the press (`href(note.noteId())`): the mode written in place by then, a new analysis's note once it has one.

## On a phone (the owner's canvas «Шапка разбора на телефоне», 07.11, variant 4)

Below 768 px the editor takes its phone form, one module for all of it: `AnalysisPhone.tsx` (`usePhoneAnalysis` reads the width on the first paint, so a phone never shows the wide bar first).
- **Bar:** ← (only in «Просмотр») · the place (pressed — `onEditVerses`) · ⋯ · «Править»/«Готово». On a phone «Готово» returns to «Просмотр»; only ← closes. The bar lies over the text and leaves while it is scrolled down in «Просмотр» (`useBarOnScroll`), back on any scroll up or near the top; in «Правка» and with ⋯ open it stays.
- **⋯** is a bottom sheet with its own modal layer (Escape, Back close it first): «Все связи», `AnalysisSermonsPanel`, the `door`, «Изменить стихи» — what the wide bar and side panel hold.
- **No margin:** the 80 px left padding (`pl-20`) exists for the step arrows and a hung verse number; on a phone the verse number stands in the line (`AnalysisLine hangNumbers={false}`) and ‹ › of the line touched are in `AnalysisEditCapsule` at the bottom, with undo. A press of any pointer points a word there (`setPointed`), since nothing hovers.
- **No marks' tools:** `useAnalysisMarks({ paints: false })` — the marks are shown, nothing paints, even with a tool in hand from the reader.
- **What the analysis says** (`message`) stands in the side panel from 1024 px; below it `useSaidOverText` shows it over the text and clears it after 5 s — iPad upright included (BUG-20261107-analysis-messages-hidden-below-lg).
- Tests: `__tests__/components/bible/analysisPhone.test.tsx` (a `matchMedia` stub that answers `min-width` and `max-width`). Live: `.cases/2026-11-06-comment-paragraph/stand/phone-accept.cjs`, `wide-check.cjs`, `sim-analysis.mjs` (iPhone Safari); a synthetic `PointerEvent` from JS throws in `setPointerCapture` — drive presses with real touches (CDP), not `dispatchEvent`.

## Doors

Every way that names an analysis as a note must land on its screen, not in a note's editor, which would take the structure for words and could write them back:
- `/studies/<id>` — the home page's rows, calendar entries, the list and arrows beside a note, old links: the page's wrapper redirects an analysis to `/studies?tab=analyses&analysis=<id>&mode=view` and never mounts the editor (`studies/[id]/page.tsx`, `StudyNotePage`).
- A sermon's sources and prep open it in the Bible, beside its passage (`noteScreenHref`).
- Share links: hidden for analyses — a share page shows a note's words.

## Traps

- **A blanket `jest.mock('../StudyAnalysisWindow')` drops its other exports** (`useStudyAnalysisOpening`, `AnalysesInvitation`) and the whole Studies suite fails «is not a function». Mock with `...jest.requireActual(...)` and replace only the window.
- **«Все» counts what the tabs show.** Analyses stand in Studies now (`utils/studyNoteTabs.ts`): the old `inStudies` filter that hid them from Studies, the home page and the calendar is gone, so all three list them.
