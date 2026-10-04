when: function timed out · Task timed out after 10 seconds · maxDuration · vercel.json · export const maxDuration · vercel-functions.test.ts · every AI route declares maxDuration · long AI route killed · 60s Hobby cap · client timeout shorter than server · valid request shown as offline or timeout · TIMEOUT_BY_CATEGORY · category 'ai' · TTS generation too slow · transcription lost after polish · split long work into batches · ranOutOfTime · withStatus · HTTP 504 on screen · aiOutOfTime · таймаут функции · лимит времени маршрута · запрос обрывается через 10 секунд · долгий маршрут ИИ · 60 секунд · таймаут клиента · разбить на партии

# Raise a route's time limit

A route gets more than Vercel's default 10 seconds only through an entry in `frontend/vercel.json`: `functions["app/api/.../route.ts"].maxDuration` (60 is the Hobby cap). The repository's gate reads only that file, not `export const maxDuration` in the route. Keep the browser's timeout above the server's budget.

## How

- The key is the route path relative to `frontend/`, exactly as the file lives: `app/api/sermons/[id]/audio/generate/route.ts`.
- Gate: `frontend/__tests__/config/vercel-functions.test.ts` scans every `app/api/**/route.ts`. A route whose source mentions an AI signal (`callWithStructuredOutput`, `openai`, `gemini`, `consumeAiUsage`, ...) must have `maxDuration >= 60` in `vercel.json`, and an entry pointing at a deleted file fails too, so rename or delete the entry with the route. A slow route without those words escapes the scanner; add it by hand.
- A route that chains phases (transcription then AI polish, generation then persistence) needs the budget explicitly, or a finished first phase is lost when the second crosses the default.
- Client side: `TIMEOUT_BY_CATEGORY` in `frontend/app/utils/apiClient.ts` gives `ai` and `audio` 90 s, deliberately above 60 s. The client clock measures the whole round trip (upload, routing, response), `maxDuration` only the function's execution; a client timeout at or below it reports valid requests as offline or timed out. 65 s was tried and reverted.
- Pair the long budget with early rejection: both transcribe routes call `validateAudioDuration` (`frontend/app/utils/server/audioServerUtils.ts`) first, so an overlong recording fails fast instead of eating the window.
- A call that still runs out of time must say so in words: a client that throws on a non-OK response attaches the status (`withStatus` in `frontend/app/utils/aiTimeFailure.ts`), and the screen asks `ranOutOfTime(error)` (504, 408 or the client's `FetchTimeoutError`) and shows `errors.aiOutOfTime` / `errors.aiOutOfTimeAudio` instead of a generic failure or "HTTP 504". The engine failure module (`actionFailureMessage.ts`) does the same for AI work inside a form. A timeout says nothing certain about the input, so the message invites a retry and only suggests a shorter text.
- Work that cannot fit even in parallel is split into several sub-60 s requests. Audio `generate` reads a slice `[offset, offset+limit)` (`resolveBatchWindow`), and the browser drives the batches (`GENERATION_BATCH_SIZE` in `frontend/app/components/audio/StepByStepWizard.tsx`). Inside one request the chunks run in a bounded pool (`TTS_CONCURRENCY`) that writes each result by index, so the order survives concatenation.

## Why

- 2026-05-25: the audio `generate` and `optimize` routes were missing from `vercel.json`. One full TTS chunk takes about 32 s, a serial 6-chunk sermon about 190 s, and the function was killed.
- 2026-07-25: `compose-plan-from-scratch` failed in production with "Task timed out after 10 seconds", and three more AI routes sat on 10 s unnoticed. The gate became a scanner instead of a list.
- 2026-09-05: a new route declared only `export const maxDuration` and failed the gate.

See also: `.howto/generate-sermon-audio.md` · `.howto/record-and-transcribe-audio.md` · `.howto/diagnose-slow-ai.md` · `.howto/get-a-deploy-through-vercel.md`
