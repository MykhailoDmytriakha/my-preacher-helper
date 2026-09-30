when: typing lags · search is slow · input freezes · field lags on first letters · keystroke latency · measure UI responsiveness · many notes · long list re-render · useDeferredValue · rAF does not fire · hidden tab · Event Timing empty · seed test data without writing · поиск тормозит · поле ввода подвисает · задержка при наборе · замер отзывчивости · много заметок

# Measure typing lag on a real screen

Found while fixing BUG-20260809-studies-search-lag (2026-09-30). The symptom only shows at volume, and the owner's volume is on production, where an agent does not sign in.

## Get the volume without writing to the database

Dev and production share one Firestore project, so creating hundreds of test notes pollutes the real database. Seed the page's own React Query cache instead:

1. Find the QueryClient through React's fiber tree — walk up from any DOM node to a fiber whose `memoizedProps.client` has `setQueryData`.
2. Read the real key (`qc.getQueryCache().findAll()`), copy one real item as a template, and `setQueryData(key, syntheticItems)`.
3. When you are done, `invalidateQueries` on that key and check that the real count is back — the persisted cache would otherwise keep the synthetic items.

## Pick an instrument that works in the automation browser

The Chrome automation window is usually reported as hidden (`document.visibilityState === 'hidden'`):

- `requestAnimationFrame` never fires, so frame-gap samplers read zero;
- `PerformanceObserver({ type: 'event' })` records nothing for text inserted by the `type` action.

What works: a capture listener on `input` that posts a `MessageChannel` message and times its arrival. The message runs after the event's synchronous work, so the gap is how long that keystroke held the main thread — exactly what freezes the field. Work that React defers (`useDeferredValue`, transitions) runs later and is not counted, which is the point. Type one letter per `type` action with a pause between them, and click the field again after any big re-render — a click queued behind a render does not focus it.

## Read the numbers honestly

A dev build is several times slower than production: compare before and after in the same build, and say so. Prove the other side too — the list must still update after the letters (count, highlights).

## Guard it in a test

`fireEvent` runs inside `act()`, which flushes deferred renders too, so it cannot tell a responsive field from a frozen one. Dispatch the event without `act` (`IS_REACT_ACT_ENVIRONMENT = false`, native value setter, `dispatchEvent(new Event('input', { bubbles: true }))`), then assert that the field shows the letter while the list has not been drawn for it yet — see `app/(pages)/(private)/studies/__tests__/searchResponsiveness.test.tsx`.
