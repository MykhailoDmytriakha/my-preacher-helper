when: Gemini 429 · RESOURCE_EXHAUSTED · rate limit · Too Many Requests · rate_limit_exceeded · RPM · TPM · RPD · quota per project · add another API key · GEMINI_API_KEY · AI Studio usage looks low · Google TTS failed (429) · retry storm · parallel AI calls · retrySameProvider · лимит запросов · слишком много запросов · превышена квота Gemini · ошибка 429 · ещё один ключ · параллельные вызовы ИИ · шторм повторов · дневной лимит

# Handle Gemini rate limits (429)

A Gemini 429 means a per-minute (RPM/TPM) or per-day (RPD) limit of the whole Google project was hit — not that a key is broken. Fix it with routing, pacing and billing, not with more keys or a global provider flip. All Gemini traffic here — text and TTS — uses the one `GEMINI_API_KEY` (`frontend/app/api/clients/ai/providerAdapters.ts`, `frontend/app/api/clients/tts.client.ts`).

## How

- Limits belong to the project, not the key: another key in the same project adds no capacity. They are counted as requests per minute, input tokens per minute and requests per day (RPD resets at midnight Pacific), and differ per model. The project's active limits are in AI Studio (`https://aistudio.google.com/rate-limit`); setting up billing moves the project to a paid tier. (Google's rate-limit page, checked 2026-09-27: `https://ai.google.dev/gemini-api/docs/rate-limits`.)
- A per-day usage chart can look low while the 429s are legitimate: a burst inside one minute trips RPM. Parallel calls and retry loops need their own pacing even at low daily totals.
- Structured output today: the OpenAI SDK retries a 429 itself (default `maxRetries: 2`, with backoff) unless the caller passes `requestOptions.maxRetries: 0`; then `classifyError` marks it `retrySameProvider` and `runWithFallback` moves to the next target in the user's chain (`frontend/app/api/clients/structuredOutput.ts`). A free user's chain is one model, so the 429 ends the call. There is no app-level queue.
- TTS today: Google runs one request at a time (`TTS_CONCURRENCY` is 1 for Google in `frontend/app/api/sermons/[id]/audio/generate/route.ts`) and the browser sends one chunk per request (`GOOGLE_GENERATION_BATCH_SIZE` in `frontend/app/components/audio/StepByStepWizard.tsx`). A 429 arrives as `Google TTS failed (429)`, is retried once after 100 ms (`TTS_CHUNK_ATTEMPTS`), then that chunk is dropped from the export.
- Don't answer a 429 by flipping `AI_MODEL_TO_USE` or the admin text default: that puts every structured flow on one quota pool. Route the hot flow elsewhere, pace it, or pay for the tier.

## Traps

- `RESOURCE_EXHAUSTED` from Firestore (entitlement reads, the data engine) is a different quota — `docs/architecture/data-engine-operations.md`.
- Transcription runs on OpenAI, not Gemini: its 429 is split into `rate_limit` (retryable) and `billing` (`insufficient_quota`, not retryable) in `frontend/app/api/clients/transcriptionRetry.ts`.

## Why

- 2026-04-30: Gemini keys inherit the project's billing and quota — extra keys in one project did not add capacity.
- 2026-05-03: AI Studio's per-day chart looked low while per-minute bursts were throttled.

See also: `.howto/generate-sermon-audio.md` · `.howto/diagnose-slow-ai.md` · `.howto/call-ai-with-structured-output.md`
