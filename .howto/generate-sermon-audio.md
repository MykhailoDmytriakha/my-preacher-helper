when: TTS · text-to-speech · audio export · sermon audio · audioChunks · /audio/optimize · /audio/generate · /audio/chunks · StepByStepWizard · Step 2 chunks · Gemini TTS · Google TTS · GEMINI_AUDIO_2_5_TTS · GEMINI_AUDIO_3_1_TTS · gemini-3.1-flash-tts · WAV silence timing · createSilenceBlob · 24kHz mono · section pause · chunk count mismatch · prepared chunks vs request chunks · splitTextEvenly · EVEN_SPLIT_IDEAL_SIZE · GOOGLE_SMALL_CHUNKING · TTS_CONCURRENCY · scripture read aloud wrong · normalizeScriptureReferencesForTts · tail context · previousContext · optimizeTextForSpeech · missing passage in audio · All TTS chunks failed · Gemini TTS free tier · озвучка · синтез речи · аудио проповеди · экспорт в аудио · генерация аудио · паузы между частями · куски аудио · стих читается неверно · пропал отрывок в аудио

# Generate sermon audio (TTS export)

Two server steps driven by `frontend/app/components/audio/StepByStepWizard.tsx`. Prepare: `POST /api/sermons/[id]/audio/optimize` turns the sermon into `audioChunks` saved on the sermon. Generate: `POST /api/sermons/[id]/audio/generate` reads those saved chunks and voices them in batches the browser drives; the browser stitches the parts into one file.

## How

- Preparation is sequential with context: each segment goes through `optimizeTextForSpeech` with the last 1000 characters of the previous optimized segment as `previousContext` — coherence needs that state, so the loop is not parallel. Spoken transitions are then woven in (`weaveTransitionChunks`). `useRawText` skips all AI rewriting, transitions and preparation admission; for Google voices the wizard offers only the raw source.
- Generation is parallel inside a batch: OpenAI up to 6 chunks at once, Google 1 (`TTS_CONCURRENCY`). The browser sends 3 chunks per request for OpenAI and 1 for Google, each a fresh request under the 60 s wall, then byte-concatenates MP3 or merges WAV.
- Chunk size: OpenAI output and raw text are re-split with `splitTextEvenly` (~1750 characters, `EVEN_SPLIT_IDEAL_SIZE`) — autoregressive TTS drifts the longer a clip gets. Google groups the saved chunks by major section, then splits each section with `splitGoogleTextForGeneration`: even chunks while `GOOGLE_SMALL_CHUNKING` (`frontend/app/config/audioGeneration.ts`) is `true`; when `false`, one request per section up to `GOOGLE_TTS_MAX_CHUNK_SIZE` (8192 input tokens × 3 characters) — the fewer-requests path.
- Two counts, labelled apart: saved `audioChunks` (what Step 2 shows) ≠ Google request chunks (after grouping and re-split). The route logs `prepared chunks → request chunks`; a difference is not a bug.
- Step 2 shows what `/audio/optimize` saved, not what `/audio/generate` sends. A fix only in `generate` doesn't change the display: provider-specific sizing belongs in preparation too; saved text is refreshed only through an explicit preparation action.
- Scripture read aloud: `normalizeScriptureReferencesForTts` (`frontend/app/utils/scriptureReferenceNormalizer.ts`) expands references into spoken words, matching every book alias of the shared reference parser (`getReferenceBookAliases`), and runs in both routes so chunks saved before a fix are still safe. It is separate from dictation's `normalizeSpokenScriptureReferences`, which keeps compact dotted references — never reuse one for the other. Today it only rewrites Russian text.
- Pauses: Google inserts 700 ms of silence only where adjacent generated chunks change `sectionId` (`insertGoogleSectionPauses`), never between split pieces of one section. The silence must match Gemini's PCM: `createSilenceBlob(ms, 24000, 1)` — the helper's defaults (44.1 kHz stereo) keep bytes silent but break timing and the file's format.
- Models: the client sends catalog ids (`gemini-3.1-flash-tts`, `gemini-2.5-flash-tts`, `gpt-4o-mini-tts`); the route authorizes them against the tier, then maps Google ids to runtime ids from `GEMINI_AUDIO_3_1_TTS` / `GEMINI_AUDIO_2_5_TTS` (underscores; server-only env, never a public one). A failing model is reported, never swapped.
- Metering: durable admission for the complete batched export, audio seconds measured from each known successful output and one AI use per export — `.howto/gate-and-meter-an-ai-call.md`. Unbatched compatibility keeps fresh admission and the existing success-only accounting.

## Traps

- A chunk that stays silent after its two attempts (`TTS_CHUNK_ATTEMPTS`) fails its whole batch before anything is metered: the stream sends `error` with code `tts-chunk-failed` (`TTS_CHUNK_FAILED`, `frontend/app/utils/audioChunkIdentity.ts`) and the chunk numbers. The wizard keeps the finished batches for the same settings and shown text, and the next press of Generate continues from the failed batch. Never let a batch succeed with a hole in it: the file would read as done while a paragraph is missing.
- Gemini TTS on the free tier: many small requests hit per-minute and per-day request limits quickly — `.howto/handle-gemini-rate-limits.md`.

## Why

- 2026-09-30: a chunk that failed twice was dropped silently and the export reported success (BUG-20260927-audio-export-drops-failed-chunk).
- 2026-05-29: 44.1 kHz stereo silence spliced into 24 kHz mono Gemini WAV shifted the timing.
- 2026-05-31: Scripture references in saved chunks were not spoken as words, pauses landed inside sections, and the two chunk counts were reported as a bug.
- 2026-07-14: Google moved to even quality chunks with browser batching, behind the one-line `GOOGLE_SMALL_CHUNKING` switch.

See also: `.howto/raise-route-time-limit.md` · `.howto/format-scripture-reference.md` · `.howto/handle-gemini-rate-limits.md`

## Independently saved sources

Owner contract, clarified 2026-10-15: prepared speech is persistent authored content. Reopening and generating audio reuse the saved text and manual edits. Only an explicit preparation action replaces the selected sections; removing a section from the selection does not delete its saved text.

The sermon stores optional `audioSources.ai/raw`, each with preparation id, monotonic per-source revision, prepared sections and chunks. `utils/preparedAudioSources.ts` owns reading legacy data, source/version guards, preservation and replacement of selected sections. Old `audioChunks/audioMetadata.mode` remain the last persisted/prepared/edited compatibility projection. Source selection in the new wizard is local and read-only; it does not publish cached arrays or synchronize tab preferences. Legacy data is promoted only on a real write, preserving its words; no bulk migration runs.

`usePreparedSpeech` keeps source state separate from selection, loading and editor sessions. The wizard supplies its existing HTTP operations. Responses merge only higher source revisions; arrival time does not establish order. Owner/sermon identity fences responses, and saving captures the editor source/version/session before awaiting. A retired preparation may contribute newer durable data but cannot replace a newer request's error state, settings or editor.

Preparation checks the opening source and the selected sections' words inside the latest canonical write (`writeOwnedDocument` / `mutateLegacyResource`), preserving all other sections and the other source. Original preparation skips text optimization, transitions and AI usage admission. Google generation only voices Original. Generation requires the selected stored source id/revision, shown words and explicit section coverage before provider work; prepared empty sections are distinguishable from unprepared sections.

Existing saved Original text is never rebuilt just by entering step 2 or changing providers. Use the visible Refresh Original action to include later sermon changes. The UI explains that preparing again replaces the selected sections, including their manual edits. Generate remains unavailable until all selected sections are prepared and there is text to voice.

The previous single-set design and two failed review rounds remain historical evidence in `.cases/2026-10-06-bugs-26/artifacts/audio-wizard-r2.patch` and `audio-wizard-review-r1.txt/r2.txt`. Phase30 local proof lives in `.cases/2026-10-15-lokalnoe-ispravlenie-vseh-bagov/artifacts/audio-source-*`; production verification still requires separately authorized publication.

## Generation lifetime

`useAudioGenerationSession` owns one active generation run, scope-tagged UI and completed-batch resume. Scope is owner+sermon within this mounted wizard; every begin has a distinct run object and AbortController. Capture that run across auth, HTTP body/stream, batch progress and asynchronous WAV assembly, and checkpoint before publishing or retaining bytes. Abort alone cannot fence already resolved work.

Cancel invalidates immediately and returns to the working view. Retrying the exact body in the same live scope can reuse completed batches; changed source/settings/body or owner/sermon/window cannot. Retired callbacks cannot update progress/errors, append bytes, download a file or clear a replacement run. Keep exact run predicates inside queued React state updaters as well as synchronous current/live checks. Leaving generation must not discard separately persisted authored preparation.

After an accepted download, usage refresh is a separate background refresh; failure must not remove the successful file. Client cancellation stops its request/publication; it does not prove refund or cancellation of provider work already admitted on the server. Local lifecycle proof and the future production plan are in the phase31 audio-lifetime artifacts.

## A refused correction

An audio correction retains its opening editor session and prepared source. A409 stores an exact separate comparison snapshot, including an explicitly absent selected source; monotonic source-cache merge cannot stand in for that response. Show both the typed and saved text. Explicit resolution submits the displayed source token and complete expected chunks through the existing correction route.

preparedAudioTargetUnchanged reuses heardChunks normalization to compare the complete layout with words blanked. Only one known preparation with the same layout can retain its index. Re-preparation/reindex requires the person to select and read the current target; a second text-only revision compares against the last submitted candidate/index so that selection remains. Old session/candidate/auth callbacks cannot post or update a replacement editor.

Use stored text updates the editor baseline only after its deliberate discard choice. Pending saves block X, backdrop, Cancel and Escape; dirty close uses useDiscardQuestion. Ordinary resolution failures stay visible beside the comparison. This is an in-memory editor, not a new durable outbox; do not promise recovery after reload.

## Admitted continuation and delivery

`useAudioGenerationSession` assigns an export ID before the first POST and retains it only for the
same mounted owner/sermon and exact source/settings body. The wizard may retry that retained attempt
when refreshed allowance is exhausted; the server decides whether it is a continuation. Changing the
body starts a new admission. Saved speech and manual corrections are independent of transport state.
A terminal continuation decision offers an explicit Start audio again action; resetting the attempt
never removes speech or bypasses the current cap.

Only App Router route entry points call the server-only `data-engine/serverOperations.server.ts`
facade. The internal `audioExport.server.ts` owns the rule. `audioExportStore.ts` exposes typed,
owner/sermon-bound operational keys; native IO stays in `data-engine/server.ts`. Do not add a legacy
SDK exception, a raw database/path escape, or a person-edit command for accounting. The unchanged
Firestore rules deny browser access to these operational collections.

The receipt binds owner, sermon, export ID, normalized plan, total, batch size and exact cursor.
At most three chunks enter a transport batch. A lease coordinates delivery; expiry never resets its
provider attempt count. Each chunk has two application attempt slots. The installed provider SDK
may make its own transport retries (currently up to three HTTP attempts per application invocation),
so this is not a two-HTTP-call promise. Exhausted slots require a fresh ordinary allowance check.
A signature or positive offset alone cannot supply replay protection.

Binary cache fragments are 512,000 bytes; fragment writes and both stale/retired cleanup paths use
at most four cached documents per transaction. Cleanup rereads the current generation before deletion.
Only the current batch occupies fixed slots for an owner/sermon. The next batch/export replaces older
slots; after an accepted download, the authenticated `/audio/generate/ack` route retires that exact
completed export and clears its binary cache. Old or foreign ACKs cannot clear another export; an
exact repeated ACK can finish interrupted cleanup even after the sermon has disappeared. ACK failure
never retracts an accepted file. Incomplete abandoned cache remains until continuation/replacement or
ACK; no TTL, scheduler or background deletion is assumed. Compact admission and output-settlement
receipts remain to reject reused identities and deduplicate accounting.

Each actual known successful output has an immutable ID and measured duration. A native transaction
settles unrecorded output IDs, the admission's one AI use and `users.usage` together while preserving
profile fields and engine metadata. A superseded successful server run still settles its known work,
but cannot publish over a newer run or overwrite its cached bytes. A cache-write error never becomes
a new paid provider attempt: available bytes remain deliverable/accountable in the current request.
If that delivery is also lost and no valid cache remains, continuation fails explicitly rather than
silently paying again. A completely failed batch retains the established no-success/no-charge policy;
unobserved provider output before a durable receipt remains outside the exact-once guarantee.

Local proof for BUG-20261003-audio-continuation-skips-limit includes behavioral RED/GREEN tests,
actual compiled Next routes with demo Auth/Firestore emulators and a synthetic local MP3 provider,
plus narrow/wide Chromium inspection. This does not prove production provider billing, platform
execution deadlines, installed PWA or physical-device behavior. Follow the case artifact
`audio-continuation-production-recipe.md` after separately authorized publication.
