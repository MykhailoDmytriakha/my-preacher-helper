when: window.matchMedia is not a function · matchMedia mock · MediaQueryList mock · ResizeObserver is not defined · ResizeObserver callback never fires · navigator.clipboard in tests · clipboard is undefined · crypto in jsdom · crypto.randomUUID is not a function · global.crypto assignment ignored · MediaRecorder in tests · navigator.mediaDevices getUserMedia mock · AudioContext mock · URL.createObjectURL is not a function · scrollIntoView is not a function · IntersectionObserver is not defined · structuredClone is not defined · navigator.onLine in tests · IndexedDB in tests · window in SSR test · typeof window === 'undefined' branch · Object.defineProperty in tests · jsdom missing API · мок браузерного API · замокать API браузера · нет API в jsdom · мок буфера обмена · мок matchMedia · мок микрофона · не определён в тестах

# Mock a browser API in a Jest test

Tests run in jsdom 20 (`jest-environment-jsdom` 29) plus the few globals `frontend/jest.setup.js` adds. Install whatever else the code touches per test with `Object.defineProperty(target, name, { configurable: true, value })`, restore the original in `afterEach`, and also test the app's fallback for when the API is absent.

## What is there (probed 2026-09-27)

- Added by the setup: `fetch` (jest-fetch-mock), `Request` / `Response` / `Headers` / `Blob` / `File` / `FormData` (undici), `setImmediate`, and a `ResizeObserver` whose methods do nothing.
- Missing in jsdom: `window.matchMedia`, `navigator.clipboard`, `navigator.mediaDevices`, `MediaRecorder`, `AudioContext`, `URL.createObjectURL`, `crypto.randomUUID` (only `getRandomValues` exists), `IntersectionObserver`, `structuredClone`, `scrollIntoView`, `window.isSecureContext`, `document.execCommand`, `indexedDB`, and `TextEncoder` / `ReadableStream` (see `.howto/test-streaming-code.md`).
- `Date.now` is frozen at 2023-01-01 by the setup.

## How

- Getter-only globals need `defineProperty`: `Object.defineProperty(global, 'crypto', { value: { randomUUID: jest.fn(() => 'uuid-1') }, configurable: true })`. Plain `global.crypto = …` is silently ignored, because jsdom's `crypto` is a getter, and the code then still sees no `randomUUID`. Restore the original the same way (`frontend/__tests__/api/repositories/sermons-repository.test.ts`).
- Clipboard: `Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: jest.fn().mockResolvedValue(undefined) } })`. TypeScript's DOM types mark it `readonly`, and `configurable: true` lets the next test redefine it. Code that checks `window.isSecureContext` needs that defined too (`frontend/app/components/diagnostics/__tests__/TechnicalDetailsButton.test.tsx`).
- Build full mocks with every method stubbed — a partial object crashes at the first method the code calls. `matchMedia` returns `{ matches, media, addEventListener, removeEventListener, addListener, removeListener, dispatchEvent, onchange }`, cast `as unknown as MediaQueryList`. Cover the fallback too: `frontend/__tests__/components/AudioRecorder.autostart.behavior.test.tsx` sets `addEventListener: undefined` to prove the legacy `addListener` path.
- To make `ResizeObserver` fire, replace `globalThis.ResizeObserver` with a class whose `observe` records `(target, callback)`, call the callback yourself, and restore it in `afterEach` (`frontend/__tests__/components/navigation/ModeToggle.test.tsx`). The setup's version never calls back.
- Recorder: assign a fake `MediaRecorder` class (with `isTypeSupported`), `navigator.mediaDevices = { getUserMedia: jest.fn().mockResolvedValue(stream) }`, `AudioContext`, `requestAnimationFrame` and `URL.createObjectURL`. Save the originals and restore them in `afterEach` (the AudioRecorder suite above). Wait for the state-driven DOM (`await waitFor` / `findBy`) before firing keyboard shortcuts: the key listener belongs to a state the first render has not reached.
- Offline: `Object.defineProperty(navigator, 'onLine', { configurable: true, value: false })`.
- IndexedDB: data-engine tests install a transactional fake with `installStorageHarness()` from `frontend/app/data-engine/__tests__/storageHarness.ts`.
- No-window (SSR) branch in one test: `Object.defineProperty(global, 'window', { value: undefined, configurable: true, writable: true })`, restored in `afterEach` (`frontend/__tests__/utils/shareNoteUtils.test.ts`). For a whole file of server code, use the `@jest-environment node` docblock: node has `TextEncoder`, `ReadableStream`, `structuredClone` and `crypto.randomUUID`, and no `window` or `document`.

## Why

- 2026-02-14: a crypto mock set by assignment never took, because jsdom exposes `crypto` through a getter; `defineProperty` goes past it.
- 2026-01-07: AudioRecorder keyboard tests failed when the keys were fired before the state-driven DOM appeared.

See also: `.howto/test-streaming-code.md` · `.howto/mock-in-jest.md` · `.howto/test-async-ui.md`
