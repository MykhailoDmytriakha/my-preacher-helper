when: transcription failed · dictation failed · ECONNRESET · socket hang up · 503 retryable · phase transcribe_audio · retry transcription · transcribeAudioWithRetry · createTranscriptionWithRetry · mapTranscriptionError · classifyTranscriptionError · TranscriptionClientError · insufficient_quota · out of credit · recording lost after error · keep the recording · retry / discard / record again · RecordingDraftBanner · saveRecordingDraft · recording drafts · malformed WebM · corrupted or unsupported audio · MediaRecorder.start · timeslice · FocusRecorderButton · grace period countdown · GRACE_PERIOD_SECONDS · NEXT_PUBLIC_AUDIO_GRACE_PERIOD · NEXT_PUBLIC_AUDIO_RECORDING_DURATION · audio file is too long · validateAudioDuration · диктовка · запись голоса · транскрибация · расшифровка не удалась · запись пропала после ошибки · повторить расшифровку · черновик записи · микрофон · запись слишком длинная

# Record and transcribe audio

The browser records with `MediaRecorder` and posts the blob to a transcribe route: `/api/thoughts/transcribe` and `/api/studies/transcribe` through `transcribeAudioWithRetry` (`frontend/app/utils/transcriptionRetryClient.ts`), a new dictated thought to `/api/thoughts` through `createAudioThought` (`frontend/app/services/thought.service.ts`). The server makes one transcription attempt and answers a failure with a typed contract; retries belong to the client, and the recording stays with its recorder until it is transcribed or discarded.

## How

- Retry where a fresh time budget exists: the server calls `createTranscriptionWithRetry` with one attempt by default (`frontend/app/api/clients/transcriptionRetry.ts`) and maps failures with `mapTranscriptionError`. Transient kinds (`network` incl. `ECONNRESET`, `rate_limit`, `server`) → `503` + `retryable: true` + `phase: 'transcribe_audio'` + `kind`. The client retries as new HTTP requests, each with its own 60 s budget. `transcribeAudioWithRetry` (2 retries by default) retries when the body says `retryable`, or by HTTP status when a 5xx/429 came with no body (a function killed at the wall); `createAudioThought` retries only on `retryable` + `phase === 'transcribe_audio'`.
- Non-retryable kinds stop at once: `billing` (`insufficient_quota`, 429), `auth` (401), `invalid_audio`, `bad_request`. `classifyTranscriptionError` checks the most specific signal first — billing before a generic 429.
- Every attempt's error is kept in `TranscriptionClientError.attempts`; a 200 with empty text counts as `invalid_audio` (silence), not success.
- Inside one attempt the model chain is the tier's allowed transcription models, each with a share of the 45 s budget and SDK `maxRetries: 0` (`createTranscription` in `frontend/app/api/clients/openAI.client.ts`).
- Keep the blob at the recorder: after a valid recording fails, the recorder that owns it keeps it listenable with retry / discard / record again (`frontend/app/components/audio-recorder/useAudioRecorderLifecycle.ts`). The parent hands back an error scoped to that recorder through `transcriptionError` / `onRetry` / `onClearError` on `AudioRecorder`; one page-wide error state shows failures in the wrong recorder or closes the popover before recovery.
- Surviving a reload: `saveRecordingDraft` parks the blob in IndexedDB (`frontend/app/utils/recordingDraftStore.ts`, 7-day expiry) and `RecordingDraftBanner` offers to resend it; only the study page wires this today.
- One container per recording: call `MediaRecorder.start()` with no timeslice. Audit every surface — `useAudioRecorderLifecycle.ts` (through `createConfiguredMediaRecorder`) and `frontend/app/components/FocusRecorderButton.tsx`, which builds its own recorder. One leftover `start(100)` brings back malformed WebM; `frontend/__tests__/components/FocusRecorderButton.test.tsx` asserts `start()` with no arguments.
- Timing has one source, `frontend/app/utils/audioRecorderConfig.ts`: base length (90 s, `NEXT_PUBLIC_AUDIO_RECORDING_DURATION`) and the 5 s end countdown (`GRACE_PERIOD_SECONDS`, `NEXT_PUBLIC_AUDIO_GRACE_PERIOD`). Recorders and the server's `validateAudioDuration` (total + 2 s) read the same config — never hard-code a timer.
- Auth and metering: `.howto/gate-and-meter-an-ai-call.md`.

## Why

- 2026-04-25: a standalone recorder button still called `start(100)` after the shared recorder was fixed, keeping the malformed-WebM failure.
- 2026-04-26: valid recordings failed on transient provider errors and the recording was lost behind a shared error state.
- 2026-07-04: retries moved from the server to the client — several attempts inside one invocation shared, and blew, one 60 s function limit.

See also: `.howto/raise-route-time-limit.md` · `.howto/mock-browser-apis-in-jest.md` · `.howto/diagnose-slow-ai.md`
