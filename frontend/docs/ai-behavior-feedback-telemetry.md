# AI Behavior Feedback Telemetry

Goal: infer prompt quality from what users do after an AI output appears.

This complements `ai_prompt_telemetry`. Prompt telemetry says what the model received and returned. Behavior feedback says whether the generated artifact survived real user workflow.

## Principle

Do not treat every edit as a failure.

Behavior signals should store:

- `signal`: what the user did.
- `polarity`: `positive`, `negative`, or `mixed`.
- `confidence`: how strongly that action implies quality.
- `field`: which part of the AI output is affected.
- `before` and `after` hashes/lengths, plus safe captured excerpts when useful.

## Core Signals

| Signal | Polarity | Confidence | Meaning |
| --- | --- | ---: | --- |
| `accepted_unchanged` | positive | 0.70 | User saved/applied output without edits. |
| `accepted_with_edits` | mixed | 0.65 | Output was useful, but needed correction. |
| `regenerated` | negative | 0.85 | User asked for another AI attempt after seeing the output. |
| `rejected_field` | negative | 0.80 | User explicitly unchecked title/tags/refs/etc. in confirmation UI. |
| `edited_after_save` | mixed | 0.55 | Persisted AI-derived object was later modified. |
| `deleted_after_generation` | negative | 0.70 | AI-derived object was removed soon after creation. |
| `abandoned_draft` | negative | 0.35 | Draft was generated but not saved/applied. Weak signal because refresh/close can be accidental. |

## Required Linkage

Every AI-derived artifact or draft needs provenance:

```ts
interface AiSourceMeta {
  artifactType: "thought" | "plan_point" | "study_note_analysis";
  artifactId?: string;
  draftId?: string;
  sourceTelemetryEventId?: string;
  correlationId: string;
  promptName: string;
  promptVersion: string;
  generatedAt: string;
  contentHash: string;
  contentLength: number;
}
```

Without this, we can see that the user edited something, but we cannot reliably say which prompt version produced the edited output.

## Recommended Collection

Use a separate collection:

```txt
ai_artifact_feedback
```

Document shape:

```ts
interface AiArtifactFeedbackEvent {
  eventId: string;
  timestamp: string;
  userId?: string;
  sermonId?: string;
  noteId?: string;
  artifactType: AiSourceMeta["artifactType"];
  artifactId?: string;
  draftId?: string;
  sourceTelemetryEventId?: string;
  correlationId: string;
  promptName: string;
  promptVersion: string;
  signal: string;
  polarity: "positive" | "negative" | "mixed";
  confidence: number;
  field?: "text" | "tags" | "title" | "scriptureRefs" | "planPointContent";
  before?: { hash: string; length: number };
  after?: { hash: string; length: number };
  changedFields?: string[];
  editDistanceRatio?: number;
}
```

Keep `ai_prompt_telemetry` as the source-of-truth for prompt/response payloads. Keep behavior events separate so prompt telemetry is not overloaded with user workflow noise.

## Surface Mapping

### Plan point content

Existing seams:

- Generate/regenerate button: `frontend/app/(pages)/(private)/sermons/[id]/plan/PlanMainLayout.tsx`
- Generate/save orchestration: `frontend/app/(pages)/(private)/sermons/[id]/plan/usePlanActions.ts`
- Save API: `frontend/app/api/sermons/[id]/plan/route.ts`

Signals:

- Generate when content already exists -> `regenerated`.
- Save generated content unchanged -> `accepted_unchanged`.
- Save after editor changes -> `accepted_with_edits`.
- Generate draft and navigate away without save -> `abandoned_draft` with low confidence.

### Thoughts

Existing seams:

- AI thought creation: `frontend/app/api/thoughts/route.ts`
- Thought update: `frontend/app/api/thoughts/route.ts`

Signals:

- Text changed from AI-created text -> `edited_after_save`, field `text`.
- Tags changed from AI-created tags -> `edited_after_save`, field `tags`.
- Thought deleted soon after generation -> `deleted_after_generation`.
- Forced tag should be stored as user override, not counted as model tag failure.

### Study notes

Existing seams:

- Analyze request: `frontend/app/api/studies/analyze/route.ts`
- Client confirmation/apply: `frontend/app/(pages)/(private)/studies/AnalysisConfirmationModal.tsx`
- Note autosave: `frontend/app/(pages)/(private)/studies/[id]/page.tsx`

Signals:

- User applies all suggested fields -> positive per field.
- User unchecks title/tags/scripture refs -> negative per rejected field.
- User applies then later edits title/tags/refs -> mixed per field.

## Rollout Order

1. Return telemetry metadata from `callWithStructuredOutput` so callers can attach `eventId`/`correlationId`.
2. Add optional `aiSource` metadata to generated artifacts and in-memory drafts.
3. Add a small server-side writer for `ai_artifact_feedback`.
4. Wire plan point first. It has the cleanest regenerate/save/edit semantics.
5. Wire thoughts next. It directly addresses dictation and generated tags.
6. Wire study note analysis confirmation. It gives explicit per-field accept/reject signals.
7. Extend admin telemetry summary to join prompt versions with behavior feedback rates.

## Metrics To Compare By Prompt Version

- `acceptanceRate = accepted_unchanged + accepted_with_edits`
- `unchangedAcceptanceRate`
- `regenerationRate`
- `fieldRejectionRate` by field
- `meanEditDistanceRatio`
- `abandonRate` as a weak warning metric, not a hard failure metric

