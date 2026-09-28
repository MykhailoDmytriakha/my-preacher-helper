when: technical details · diagnostic report · developer information · appDiagnostics · recordDiagnostic · TechnicalDetailsButton · TechnicalDetailsDialog · DiagnosticsRecorder · buildDiagnosticReport · diagnosticRoute · diagnosticErrorCode · unclear state · stuck screen · copy report · /api/health · report closes when the warning disappears · route id in the report · технические подробности · диагностический отчёт · скопировать отчёт · непонятное состояние · экран завис · информация для разработчика

# Show technical details for an unclear state

When a screen can land in a state the person cannot explain (a stuck load, a freshness warning), put a `TechnicalDetailsButton` next to the message. It opens one shared viewer with a copyable, content-free report built by `frontend/app/utils/appDiagnostics.ts`.

## How

- The button only dispatches a window event. The viewer, `TechnicalDetailsDialog`, is mounted once in `frontend/app/(pages)/(private)/layout.tsx`; keep it there, because recovery can unmount the warning that opened it, and a viewer owned by the warning would close mid-read. Current callers: `frontend/app/components/DataFreshnessBanner.tsx`, the groups page, the structure page.
- Record an event with `recordDiagnostic(name, data)`. The name must be in the `EVENTS` list; data keeps only whitelisted keys (`route`, `source`, `code`, `collection`, `result`, a few booleans, `elapsedMs`), and strings only when they are short `[a-zA-Z-]` words. For an error pass `diagnosticErrorCode(error)`, never the error.
- Never record documents, raw error messages, account ids or credentials. Routes pass through `diagnosticRoute`, which drops the query string and turns every segment outside its fixed list into `:id`, so a new static route segment reads as `:id` until you add it to that list.
- Storage is best effort, on this device only: `localStorage`, the last 80 events within 24 hours, merged across tabs. Every server snapshot keeps its own timestamp; only an identical `snapshot-cache` or `snapshot-pending` repeated within one second is dropped.
- Who records: `DiagnosticsRecorder` (mounted in the private layout outside the chrome gate) for boot, route, auth, visibility, focus, online/offline, page show/hide, runtime errors classified as `chunk-load` or `javascript`, and service-worker changes; `useDocumentFreshness` for snapshot kinds, checks, timeouts and late answers or errors; read paths (`sermonReadFallback.client.ts`, `ownerListRead.client.ts`, `useSermonStructureData`) for start, answer and failure; `appDiagnostics.ts` itself when device storage goes silent or answers again.
- The person copies the report by hand. Nothing is sent, and it is not a feedback submission.
- The server line reads `/api/health` with a unique query (`?diagnostic=<time>`), `cache: 'no-store'` and a 5-second timeout, so a cached PWA answer cannot pass for the version the server serves now.

## Why

- 2026-09-05: the viewer is owned by the layout so that recovery, which removes the warning, cannot close a report the person is reading.
- 2026-09-27: device storage state joined the report; a report of a blank council said where the person went, but not what the screen was waiting for (`BUG-20260927-engine-open-hangs-on-silent-device-storage`, in the code comment).
