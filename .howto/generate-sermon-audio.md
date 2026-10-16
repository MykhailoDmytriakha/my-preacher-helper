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
- Metering: admission on the first batch, audio seconds measured from the generated audio, one AI use per export — `.howto/gate-and-meter-an-ai-call.md`.

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
