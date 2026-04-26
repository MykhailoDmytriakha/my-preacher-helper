# AI Prompt Telemetry Review Loop

Goal: improve prompts through reviewed production examples, not through raw JSON success counts.

## Outcome Layers

- `jsonStructureStatus`: provider/schema outcome for `callWithStructuredOutput`.
  - `success` means the model returned valid structured JSON.
  - It does not mean the output was useful to the user.
- `qualityReview.quality`: human/domain review outcome.
  - `unreviewed`: default for new telemetry.
  - `good`: keep as a positive example.
  - `bad`: use as a failing prompt example.
  - `needs_review`: suspicious, but not yet classified.

## Protected Admin Access

All endpoints require `x-admin-secret: $ADMIN_SECRET`.

Production stays disabled unless both are set:

- `ADMIN_SECRET`
- `ALLOW_ADMIN_TELEMETRY_IN_PRODUCTION=true`

## Review Workflow

Recommended cadence: monthly, or after a meaningful prompt/code version bump.

1. Get version summary:

```bash
curl -H "x-admin-secret: $ADMIN_SECRET" \
  "http://localhost:3000/api/admin/telemetry"
```

2. Pull recent examples for one prompt:

```bash
curl -H "x-admin-secret: $ADMIN_SECRET" \
  "http://localhost:3000/api/admin/telemetry/polishTranscription?version=v3&limit=50"
```

3. Mark a bad example:

```bash
curl -X PATCH \
  -H "content-type: application/json" \
  -H "x-admin-secret: $ADMIN_SECRET" \
  -d '{
    "eventId": "EVENT_ID",
    "quality": "bad",
    "reviewedBy": "admin",
    "issueTypes": ["scripture_reference_format"],
    "notes": "Dictated reference stayed as prose.",
    "expectedOutput": "Втор. 10:11"
  }' \
  "http://localhost:3000/api/admin/telemetry/polishTranscription"
```

4. Pull reviewed examples:

```bash
curl -H "x-admin-secret: $ADMIN_SECRET" \
  "http://localhost:3000/api/admin/telemetry/polishTranscription?quality=bad"
```

```bash
curl -H "x-admin-secret: $ADMIN_SECRET" \
  "http://localhost:3000/api/admin/telemetry/polishTranscription?quality=good&examples=true"
```

5. Fix prompt/code, then bump `promptVersion`.
6. Update the Review Baselines section below.

Compare new version metrics against old version:

- `jsonStructureSuccessRate`
- `reviewedCount`
- `goodRate`
- `badRate`
- `exampleCount`
- issue types from reviewed bad examples

## Raw vs Output Review Rule

Always inspect the source text and the model output as a pair. For dictation flows this means raw transcription/input first, then the structured output (`formattedText`, tags, plan content, note analysis, etc.).

Classify the delta:

- `good`: the model cleaned dictation, preserved meaning, normalized an explicit spoken reference, or added a citation anchored in a quote/story/event the user actually mentioned.
- `over_generation`: the model added sermon context, a main verse, a thematic support verse, a theological bridge, or an application that was not in the source.
- `under_generation`: the model left raw speech artifacts, missed a clear reference normalization, or failed to structure explicit content.

Example rule for thoughts: `(Быт. 24:12-14)` is acceptable when the raw input says "раб Авраама молился...", but `(Прит. 3:5-6)` is a failure when it came only from the sermon context rather than the dictated thought.

## Review Baselines

Use this table as the prompt-review watermark. A future review should start from the current version and the next scope listed here. Older versions are history/comparison unless the user explicitly asks to audit history.

| Prompt | Baseline version | Baseline review date | Reviewed window / reason | Next primary review scope |
| --- | --- | --- | --- | --- |
| `thought` | `v5` | 2026-04-25 | Created after reviewing `thought@v3/v4` raw transcript → output examples where the model added sermon-context and thematic references. | Review new `thought@v5` records after 2026-04-25 usage. Treat `v3/v4` as history/regression examples. |
| `polishTranscription` | `v3` | 2026-04-25 | Created after dictated Scripture reference formatting review; old retained records were `v2`. | Review new `polishTranscription@v3` records after 2026-04-25 usage. Treat `v2` as history. |
| `plan_point_content` | `v5` | 2026-04-26 | Created after `v4` review found that one-heading-per-thought compressed sermon-roadmap meaning and lost explicit numbered inner structures. | Review new `plan_point_content@v5` records after 2026-04-26 usage. Treat `v4` as history/regression examples. |
| `studyNoteAnalysis` | `v2` | 2026-04-25 | Created after `v1` review found tag-count/schema mismatch and redundant reference ranges. | Review new `studyNoteAnalysis@v2` records after 2026-04-25 usage. |
| `sermon_verses` | `v2` | 2026-04-25 | Created after prompt/schema key mismatch review. | Review new `sermon_verses@v2` records after 2026-04-25 usage. |
| `sermon_directions` | `v2` | 2026-04-25 | Created after prompt/schema key mismatch review. | Review new `sermon_directions@v2` records after 2026-04-25 usage. |

When a review completes, update this table in the same change as any prompt version bump. If no code change was made, still update the reviewed window/date so the next review does not repeat the same telemetry slice.

## Version Rule

Any change that can affect final AI output must increment `promptVersion`, even if the fix is partly deterministic postprocessing.

## Current Prompt Inventory

Structured telemetry prompts:

| Prompt | Version | Main purpose |
| --- | --- | --- |
| `thought` | `v5` | Turn dictated sermon thought into polished prose + tags without adding sermon-context material not dictated by the user. |
| `polishTranscription` | `v3` | Clean raw voice transcription for notes/thought text. |
| `studyNoteAnalysis` | `v2` | Extract study-note title, Scripture refs, and tags. |
| `plan_point_content` | `v5` | Generate a scannable semantic preaching map for one outline point. |
| `sermon_verses` | `v2` | Suggest related Bible verses. |
| `sermon_directions` | `v2` | Suggest research/development directions. |
| `sermon_insights` | `v1` | Generate topics, verses, and directions together. |
| `sermon_topics` | `v1` | Extract sermon topics/themes. |
| `section_hints` | `v1` | Suggest intro/main/conclusion organization hints. |
| `sermon_points` | `v1` | Generate outline points for a section. |
| `brainstorm_suggestion` | `v1` | Generate one thinking prompt to unblock sermon work. |
| `sort_items` | `v1` | Sort thoughts and assign outline/sub-point placement. |
| `plan_for_section` | `v1` | Generate section-level plan content. |
| `speech_optimization` | `v1` | Convert written sermon text to TTS-friendly chunks. |

Non-structured AI path:

- `createTranscription()` uses audio transcription and is not currently persisted to `ai_prompt_telemetry`.

## Monthly Review Checklist

For each prompt/version:

- Check whether `jsonStructureSuccessRate` changed.
- Check the Review Baselines table and identify the current version/date scope.
- Pull 10-50 newest examples for the current version only.
- If the current version has no new records, report that and stop; do not expand into old versions unless doing explicit regression/history analysis.
- Read raw source text inside `request.userMessage.value` and `response.parsedOutput.value` together.
- Classify output deltas as grounded transformation, over-generation, or under-generation before changing prompts.
- Mark high-quality examples with `quality=good&keepAsExample=true`.
- Mark failures with specific `issueTypes`.
- Prefer small prompt/schema/postprocessing fixes over broad rewrites.
- Bump `promptVersion` for every output-affecting change.
- Update the Review Baselines table with the version/date/window reviewed.

Suggested issue types:

- `wrong_language`
- `wrong_json_shape`
- `missing_context`
- `scripture_reference_format`
- `scripture_reference_mapping`
- `over_generation`
- `under_generation`
- `format_too_verbose`
- `tags_wrong_or_missing`
- `meaning_not_preserved`
