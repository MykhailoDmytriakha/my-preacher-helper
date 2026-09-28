when: TTS · text-to-speech · audio export · sermon audio · audioChunks · /audio/optimize · /audio/generate · /audio/chunks · StepByStepWizard · Step 2 chunks · Gemini TTS · Google TTS · GEMINI_AUDIO_2_5_TTS · GEMINI_AUDIO_3_1_TTS · gemini-3.1-flash-tts · WAV silence timing · createSilenceBlob · 24kHz mono · section pause · chunk count mismatch · prepared chunks vs request chunks · splitTextEvenly · EVEN_SPLIT_IDEAL_SIZE · GOOGLE_SMALL_CHUNKING · TTS_CONCURRENCY · scripture read aloud wrong · normalizeScriptureReferencesForTts · tail context · previousContext · optimizeTextForSpeech · missing passage in audio · All TTS chunks failed · Gemini TTS free tier · озвучка · синтез речи · аудио проповеди · экспорт в аудио · генерация аудио · паузы между частями · куски аудио · стих читается неверно · пропал отрывок в аудио

# Generate sermon audio (TTS export)

Two server steps driven by `frontend/app/components/audio/StepByStepWizard.tsx`. Prepare: `POST /api/sermons/[id]/audio/optimize` turns the sermon into `audioChunks` saved on the sermon. Generate: `POST /api/sermons/[id]/audio/generate` reads those saved chunks and voices them in batches the browser drives; the browser stitches the parts into one file.

## How

- Preparation is sequential with context: each segment goes through `optimizeTextForSpeech` with the last 1000 characters of the previous optimized segment as `previousContext` — coherence needs that state, so the loop is not parallel. Spoken transitions are then woven in (`weaveTransitionChunks`). `useRawText` skips the rewrite; for Google voices the wizard offers only the raw source.
- Generation is parallel inside a batch: OpenAI up to 6 chunks at once, Google 1 (`TTS_CONCURRENCY`). The browser sends 3 chunks per request for OpenAI and 1 for Google, each a fresh request under the 60 s wall, then byte-concatenates MP3 or merges WAV.
- Chunk size: OpenAI output and raw text are re-split with `splitTextEvenly` (~1750 characters, `EVEN_SPLIT_IDEAL_SIZE`) — autoregressive TTS drifts the longer a clip gets. Google groups the saved chunks by major section, then splits each section with `splitGoogleTextForGeneration`: even chunks while `GOOGLE_SMALL_CHUNKING` (`frontend/app/config/audioGeneration.ts`) is `true`; when `false`, one request per section up to `GOOGLE_TTS_MAX_CHUNK_SIZE` (8192 input tokens × 3 characters) — the fewer-requests path.
- Two counts, labelled apart: saved `audioChunks` (what Step 2 shows) ≠ Google request chunks (after grouping and re-split). The route logs `prepared chunks → request chunks`; a difference is not a bug.
- Step 2 shows what `/audio/optimize` saved, not what `/audio/generate` sends. A fix only in `generate` doesn't change the display: provider-specific sizing belongs in preparation too, and stale saved chunks may need a re-prepare.
- Scripture read aloud: `normalizeScriptureReferencesForTts` (`frontend/app/utils/scriptureReferenceNormalizer.ts`) expands references into spoken words, matching every book alias of the shared reference parser (`getReferenceBookAliases`), and runs in both routes so chunks saved before a fix are still safe. It is separate from dictation's `normalizeSpokenScriptureReferences`, which keeps compact dotted references — never reuse one for the other. Today it only rewrites Russian text.
- Pauses: Google inserts 700 ms of silence only where adjacent generated chunks change `sectionId` (`insertGoogleSectionPauses`), never between split pieces of one section. The silence must match Gemini's PCM: `createSilenceBlob(ms, 24000, 1)` — the helper's defaults (44.1 kHz stereo) keep bytes silent but break timing and the file's format.
- Models: the client sends catalog ids (`gemini-3.1-flash-tts`, `gemini-2.5-flash-tts`, `gpt-4o-mini-tts`); the route authorizes them against the tier, then maps Google ids to runtime ids from `GEMINI_AUDIO_3_1_TTS` / `GEMINI_AUDIO_2_5_TTS` (underscores; server-only env, never a public one). A failing model is reported, never swapped.
- Metering: admission on the first batch, audio seconds measured from the generated audio, one AI use per export — `.howto/gate-and-meter-an-ai-call.md`.

## Traps

- A chunk that fails twice (`TTS_CHUNK_ATTEMPTS`) is skipped and the export goes on; only `All TTS chunks failed` stops it. A passage missing from the audio → look for `[TTS] Chunk … failed` in the server log.
- Gemini TTS on the free tier: many small requests hit per-minute and per-day request limits quickly — `.howto/handle-gemini-rate-limits.md`.

## Why

- 2026-05-29: 44.1 kHz stereo silence spliced into 24 kHz mono Gemini WAV shifted the timing.
- 2026-05-31: Scripture references in saved chunks were not spoken as words, pauses landed inside sections, and the two chunk counts were reported as a bug.
- 2026-07-14: Google moved to even quality chunks with browser batching, behind the one-line `GOOGLE_SMALL_CHUNKING` switch.

See also: `.howto/raise-route-time-limit.md` · `.howto/format-scripture-reference.md` · `.howto/handle-gemini-rate-limits.md`
