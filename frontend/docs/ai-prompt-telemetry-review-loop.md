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

## Prompt Names

Prompt keys say **where in the app** the call happens and **which step it is**:
`sermon.conspect.point`, `dictation.transcript_cleanup`, `studies.note.analyze_tags`.
The map of key → area, stage, human name and UI location lives in
`app/api/clients/ai/promptRegistry.ts`; the summary endpoint returns the human
name alongside the key.

Records written before the rename (`plan_point_content`, `thought`,
`polishTranscription`, `studyNoteAnalysis`, …) are folded onto the current key by
`resolvePromptKey`, so history does not split. The Review Baselines table below
still lists the historical names — that is deliberate, it records what was true
when each version shipped.

A prompt used in code but missing from the registry fails
`__tests__/api/clients/promptRegistry.test.ts`, and so does a registry entry that
no code uses.

## Protected Admin Access

All endpoints require a **Firebase ID token of an admin account**:
`Authorization: Bearer <idToken>` — see `requireAdminEmail` in
`app/api/admin/adminAuth.ts`. A missing or non-admin token returns `401`.

> The header `x-admin-secret: $ADMIN_SECRET` documented here previously is no
> longer accepted — the endpoints were moved onto bearer + admin-email checks
> during the app-wide auth hardening. Verified 2026-07-27: the old header returns
> `Unauthorized`.

In production the telemetry endpoints stay disabled unless
`ALLOW_ADMIN_TELEMETRY_IN_PRODUCTION=true` is set as well.

## Review Workflow

Recommended cadence: monthly, or after a meaningful prompt/code version bump.

1. Get version summary:

```bash
curl -H "Authorization: Bearer $ADMIN_ID_TOKEN" \
  "http://localhost:3000/api/admin/telemetry"
```

2. Pull recent examples for one prompt:

```bash
curl -H "Authorization: Bearer $ADMIN_ID_TOKEN" \
  "http://localhost:3000/api/admin/telemetry/dictation.transcript_cleanup?version=v3&limit=50"
```

3. Mark a bad example:

```bash
curl -X PATCH \
  -H "content-type: application/json" \
  -H "Authorization: Bearer $ADMIN_ID_TOKEN" \
  -d '{
    "eventId": "EVENT_ID",
    "quality": "bad",
    "reviewedBy": "admin",
    "issueTypes": ["scripture_reference_format"],
    "notes": "Dictated reference stayed as prose.",
    "expectedOutput": "Втор. 10:11"
  }' \
  "http://localhost:3000/api/admin/telemetry/dictation.transcript_cleanup"
```

4. Pull reviewed examples:

```bash
curl -H "Authorization: Bearer $ADMIN_ID_TOKEN" \
  "http://localhost:3000/api/admin/telemetry/dictation.transcript_cleanup?quality=bad"
```

```bash
curl -H "Authorization: Bearer $ADMIN_ID_TOKEN" \
  "http://localhost:3000/api/admin/telemetry/dictation.transcript_cleanup?quality=good&examples=true"
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
| `thought` | `v6` | 2026-05-31 | Created after `thought@v5` telemetry for sermon `tbStMzcL9xcKjMJuLVfk` showed deprecated structural tag `Основная часть` added even though the available tag list contained only auxiliary tags. Removed structural-tag prompt guidance and added deterministic tag sanitization. | Review new `thought@v6` records after 2026-05-31 usage. Treat `v3/v4/v5` as history/regression examples. |
| `polishTranscription` | `v3` | 2026-04-25 | Created after dictated Scripture reference formatting review; old retained records were `v2`. | Review new `polishTranscription@v3` records after 2026-04-25 usage. Treat `v2` as history. |
| `plan_point_content` | `v13` | 2026-06-15 | Structure now owns the headings, the model writes only the FILLING. Removed the `anchor` field (it produced a heading nested inside the outline-point heading — "heading in heading"). Sub-point group headings are emitted as real `### ` headings again (v11 had downgraded them to bold labels, which flattened the sub-point hierarchy: no marker, broken indentation, sub-points rendered weaker than the redundant anchor). The Word ref-line detector now matches abbreviated, italic-wrapped refs so they indent under their sub-point. History: v9 = structured cue-card; v10 = refs carry verse text; v11 = layout reshape (turn on top, per-group inline refs, sub-points as bold); v12 = arrows canonicalized to `→` + one verse per line. | Review new `plan_point_content@v13` records after 2026-06-15 usage. Treat `v4`–`v12` as history/regression examples. |
| `studyNoteAnalysis` | `v2` | 2026-04-25 | Created after `v1` review found tag-count/schema mismatch and redundant reference ranges. | Review new `studyNoteAnalysis@v2` records after 2026-04-25 usage. |
| `sermon_verses` | `v2` | 2026-04-25 | Created after prompt/schema key mismatch review. | Review new `sermon_verses@v2` records after 2026-04-25 usage. |
| `sermon_directions` | `v2` | 2026-04-25 | Created after prompt/schema key mismatch review. | Review new `sermon_directions@v2` records after 2026-04-25 usage. |

When a review completes, update this table in the same change as any prompt version bump. If no code change was made, still update the reviewed window/date so the next review does not repeat the same telemetry slice.

## Version Rule

Any change that can affect final AI output must increment `promptVersion`, even if the fix is partly deterministic postprocessing.

## Current Prompt Inventory

Structured telemetry prompts:

| Key | Version | Human name | Main purpose |
| --- | --- | --- | --- |
| `sermon.scratch.to_outline` | `v3-keys` | Проповедь · Наброски · разложить наброски в план | Place scratch notes into outline points. |
| `sermon.thoughts.transcript_polish` | `v6` | Проповедь · Мысли · диктовка → мысль (проза + теги) | Turn dictated sermon thought into polished prose + auxiliary tags only, without adding sermon-context material or deprecated structural section tags. |
| `sermon.ideas.suggest` | `v1` | Проповедь · Идеи · подсказка, когда застрял | Generate one thinking prompt to unblock sermon work. |
| `sermon.insights.all` | `v1` | Проповедь · Размышления · всё сразу | Generate topics, verses, and directions together. |
| `sermon.insights.topics` | `v1` | Проповедь · Размышления · темы | Extract sermon topics/themes. |
| `sermon.insights.verses` | `v2` | Проповедь · Размышления · стихи | Suggest related Bible verses. |
| `sermon.insights.directions` | `v2` | Проповедь · Размышления · направления | Suggest research/development directions. |
| `sermon.insights.section_hints` | `v1` | Проповедь · Размышления · предположенный план | Suggest intro/main/conclusion organization hints. |
| `sermon.structure.focus.generate_outline` | `v1` | Проповедь · Структура · режим фокуса · создать пункты плана | Generate outline points for a section. |
| `sermon.structure.sort` | `v1` | Проповедь · Структура · разложить мысли по пунктам | Sort thoughts and assign outline/sub-point placement. |
| `sermon.conspect.section` | `v1` | Проповедь · Конспект · текст раздела | Generate section-level conspect content. |
| `sermon.conspect.point` | `v13` | Проповедь · Конспект · текст одного пункта | Generate the FILLING of a preacher cue sheet for one outline point or its sub-points (the headings come from the sermon structure): route arrow on top, sub-points as real `### ` sub-headings, per-group Scripture refs rendered inline one per line; no model-generated title. Detailed mode preserves more source-supported references, fragments, examples, and transitions. |
| `sermon.export.speech_text` | `v1` | Проповедь · Экспорт · текст под озвучку | Convert written sermon text to TTS-friendly chunks. |
| `sermon.export.part_links` | `v1` | Проповедь · Экспорт · вступление, связки между частями, концовка | Spoken intro, per-part lead-ins and closing for the audio export. |
| `dictation.transcript_cleanup` | `v3` | Диктовка · вычитка расшифровки (без тегов) | Clean raw voice transcription for notes/thought text. |
| `studies.note.analyze_all` | `v2` | Изучение · Заметка · разобрать целиком | Extract study-note title, Scripture refs, and tags. |
| `studies.note.analyze_title` | `v2` | Изучение · Заметка · только заголовок | Same prompt family, title only. |
| `studies.note.analyze_tags` | `v2` | Изучение · Заметка · только теги | Same prompt family, tags only. |
| `studies.note.analyze_refs` | `v2` | Изучение · Заметка · только ссылки на Писание | Same prompt family, Scripture refs only. |

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
- `deprecated_structural_tag`
- `meaning_not_preserved`
