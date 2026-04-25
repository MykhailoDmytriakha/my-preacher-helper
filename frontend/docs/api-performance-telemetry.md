# API Performance Telemetry

## Purpose

API performance telemetry records how long AI-heavy endpoints take from server route entry to server response creation.

This is separate from `ai_prompt_telemetry`:

- `ai_prompt_telemetry` answers: what prompt input/output did the model see?
- `api_performance_telemetry` answers: how long did the endpoint and each major phase take?

The first target is dictation, where the user records audio and waits for a thought or polished text to appear.

## Firestore Collection

Default collection:

```text
api_performance_telemetry
```

Override:

```text
API_PERFORMANCE_TELEMETRY_COLLECTION
```

Persistence is best-effort and non-blocking. If `FIREBASE_SERVICE_ACCOUNT` is missing, telemetry is skipped and the endpoint still responds normally.

## Instrumented Routes

### `POST /api/thoughts`

Operation:

```text
thought_audio_create
```

This is the main "dictate a thought and save it into sermon" path.

Recorded phases:

- `parse_form_data`
- `validate_audio_duration`
- `fetch_sermon`
- `fetch_required_tags`
- `fetch_custom_tags`
- `transcribe_audio`
- `generate_thought`
- `persist_thought`

Safe context fields include:

- `sermonId`
- `hasForceTag`
- `hasOutlinePointId`
- `audioSizeBytes`
- `audioType`
- `audioDurationSeconds`
- `transcriptionLength`
- `availableTagsCount`
- `generationMeaningPreserved`
- `usedFallback`
- `formattedTextLength`
- `generatedTagsCount`
- `thoughtId`

### `POST /api/thoughts/transcribe`

Operation:

```text
thought_audio_transcribe_polish
```

This is the "append dictated text to an existing thought" path.

Recorded phases:

- `parse_form_data`
- `validate_audio_duration`
- `transcribe_audio`
- `polish_transcription`

### `POST /api/studies/transcribe`

Operation:

```text
study_audio_transcribe_polish
```

This is the study-note dictation path.

Recorded phases:

- `parse_form_data`
- `validate_audio_duration`
- `transcribe_audio`
- `polish_transcription`

## Event Shape

Each document contains:

```ts
{
  eventId: string;
  correlationId: string;
  timestamp: string;
  route: string;
  method: string;
  operation: string;
  status: "success" | "error";
  httpStatus: number;
  durationMs: number;
  phases: Array<{
    name: string;
    status: "success" | "error";
    durationMs: number;
    metadata: Record<string, unknown> | null;
    errorMessage: string | null;
  }>;
  context: Record<string, unknown> | null;
  errorMessage: string | null;
  createdAt: FirestoreServerTimestamp;
}
```

No raw audio, raw transcript, polished text, generated thought text, prompt body, or model output is stored here. Text quality still belongs in AI prompt telemetry and manual review examples.

## How To Read It

Useful first questions:

- Which operation has the highest p50/p95 `durationMs`?
- Which phase dominates slow successful requests?
- Are slow requests correlated with larger `audioSizeBytes` or longer `audioDurationSeconds`?
- Are failures concentrated in `validate_audio_duration`, `transcribe_audio`, or `generate_thought`?
- Does `usedFallback=true` correlate with longer `generate_thought` because of retries?

Recommended monthly review slice:

```text
operation == "thought_audio_create"
timestamp >= last review date
```

For every slow event, compare:

```text
total durationMs
phase durationMs values
audioDurationSeconds
generationMeaningPreserved
usedFallback
httpStatus
errorMessage
```

## Important Limitation

This measures server-side endpoint time. It does not yet measure full perceived user time:

```text
recording stopped -> upload started -> server work -> response downloaded -> React state updated -> thought visible
```

If server telemetry shows acceptable timings but the UI still feels slow, add a second client-side telemetry event around `createAudioThoughtWithForceTag()` to capture browser upload/download/render time.
