when: ReadableStream is not defined · TextEncoder is not defined · TextDecoder is not defined · TextEncoder is not a constructor · NDJSON stream test · newline-delimited JSON · streaming route handler test · route test returns 500 · response.body.getReader mock · fake stream reader · StepByStepWizard test · audio generate route test · audio_chunk · download_complete · stream error event · Failed to parse stream line · Audio Ready! · @jest-environment node · тест стрима · потоковый ответ · поток NDJSON · тест потокового маршрута · ReadableStream не определён · тест мастера аудио

# Test streaming code (NDJSON routes and their readers)

A streaming route test runs in node (`@jest-environment node` docblock), installs `ReadableStream` / `TextEncoder` / `TextDecoder` before it loads the route, and parses the body line by line. The model is `frontend/__tests__/api/sermons/[id]/audio/generate/route.test.ts`. The reading side is tested by giving the component a fake `response.body.getReader()` that yields encoded lines. The model is `frontend/__tests__/components/audio/StepByStepWizard.test.tsx`.

## How

- Route side: jsdom has no `TextEncoder`, `TextDecoder` or `ReadableStream`. The route builds its body with `new ReadableStream` and encodes each event with `new TextEncoder()` (`sendEvent` in `frontend/app/api/sermons/[id]/audio/generate/route.ts`). Both sit inside the handler's `try`, so a missing global becomes a 500 before the stream starts — it looks like a route bug. At the top of the test: `globalThis.ReadableStream = globalThis.ReadableStream || ReadableStream` (from `node:stream/web`), the same for `TextEncoder` / `TextDecoder` (from `util`). Load the route with `require(...)` after those lines.
- Reading the body: `response.body.getReader()`, decode each chunk with `TextDecoder` and `{ stream: true }`, split on `\n`, drop empty lines, `JSON.parse` each one (`readStreamEvents` in the route test).
- Client side: `global.fetch = jest.fn()` resolving to `{ ok: true, body: { getReader: () => mockReader } }`. Chain `mockReader.read` with `mockResolvedValueOnce({ done: false, value: encoder.encode(JSON.stringify(event) + '\n') })` and end with `{ done: true }`. Under jsdom, polyfill `TextEncoder` / `TextDecoder` from `util` at the top of the file and stub `URL.createObjectURL`.
- StepByStepWizard events (`applyBatchEvent` in `frontend/app/components/audio/StepByStepWizard.tsx`): `audio_chunk` carries base64 audio; `download_complete` or `complete` carries the file name and MIME type; `progress` drives the bar; `error` throws.
- Success: `download_complete` alone reaches "Audio Ready!", because the file is built from whatever chunks arrived, even none. To check what gets downloaded, send `audio_chunk` events and inspect the `Blob` passed to `URL.createObjectURL`.
- Errors: an `error` event's `message` is rendered and the wizard returns to the Generate button, so assert that text. A line that is not JSON is logged and skipped, so assert a `jest.spyOn(console, 'error')` called with `'Failed to parse stream line:'`. Both are in the test "returns to the wizard on a stream error event and logs malformed lines".

## Why

- 2026-02-27: route tests without the polyfills failed before the stream started and reported 500s that looked like route bugs.

See also: `.howto/mock-browser-apis-in-jest.md` · `.howto/mock-in-jest.md`
