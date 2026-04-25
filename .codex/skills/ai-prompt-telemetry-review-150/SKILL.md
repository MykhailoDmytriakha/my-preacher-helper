---
name: ai-prompt-telemetry-review-150
description: Review and improve this project's AI prompts using Firebase `ai_prompt_telemetry`, prompt blueprints, Zod schemas, and prompt-version comparisons. Use when the user asks to inspect AI telemetry, review prompt inputs/outputs, improve prompts, compare prompt versions, or run the monthly manual prompt-quality review.
---

# AI Prompt Telemetry Review 150

## Purpose

This project uses AI prompt telemetry to improve prompts from real examples.

Telemetry answers:

- What prompt/system/user input was sent?
- What structured JSON came back?
- Which prompt name and version produced it?
- Did the model return valid structured JSON?
- Did a human reviewer mark the example as good, bad, needs review, or keep-as-example?

Telemetry does **not** automatically prove user-visible quality. `status: success` or `jsonStructureStatus: success` means the structured-output call produced valid JSON. It does not mean the thought, plan, tags, references, or transcription were good.

## Core Locations

- Telemetry writer: `frontend/app/api/clients/aiTelemetry.ts`
- Structured-output join point: `frontend/app/api/clients/structuredOutput.ts`
- Prompt blueprint builder: `frontend/app/api/clients/promptBuilder.ts`
- Admin review endpoints:
  - `frontend/app/api/admin/telemetry/route.ts`
  - `frontend/app/api/admin/telemetry/[promptName]/route.ts`
- Review-loop docs: `frontend/docs/ai-prompt-telemetry-review-loop.md`
- Prompt files: `frontend/app/config/prompts/`
- Zod schemas: `frontend/app/config/schemas/zod/`
- AI clients: `frontend/app/api/clients/`

Default Firestore collection: `ai_prompt_telemetry`.

## Current Lightweight Strategy

The project intentionally defers behavior-derived feedback telemetry as a large feature.

Use the simpler monthly loop:

1. Pull recent telemetry examples.
2. Read prompt input/raw transcription and parsed output together.
3. Mark good/bad examples through admin endpoints when needed.
4. Fix small prompt/schema/postprocessing issues.
5. Bump `promptVersion` for output-affecting changes.
6. Compare the next month/version against the previous version.

## Review Workflow

### 1. Load Project Context

- Read `MEMORY.md`.
- Read the current `.sessions/SESSION_*.md` log if one exists for prompt telemetry work.
- Read `frontend/docs/ai-prompt-telemetry-review-loop.md`.

### 2. Build Prompt Inventory

Search code for:

```bash
rg -n "callWithStructuredOutput|promptName:|promptVersion:|buildSimplePromptBlueprint|buildPromptBlueprint" frontend/app/api/clients frontend/app/config
```

For every prompt, record:

- `promptName`
- `promptVersion`
- system prompt source
- user prompt source
- Zod response schema
- API/UI surface that triggers it
- postprocessing after the model returns

### 3. Pull Read-Only Telemetry

If using local env, load `frontend/.env.local` through Next env loader:

```bash
cd frontend
node -e "require('@next/env').loadEnvConfig(process.cwd()); console.log(Boolean(process.env.FIREBASE_SERVICE_ACCOUNT))"
```

Use a read-only Firestore query. If sandbox DNS fails, request escalation because Firestore network access is required.

Recommended aggregation fields:

- `promptName`
- `promptVersion`
- `jsonStructureStatus` or legacy `status`
- `qualityReview.quality`
- raw source text when present (`Транскрипция`, `originalText`, or the relevant input field)
- `request.userMessage.value`
- `response.parsedOutput.value`
- `request.context`

Do not dump huge raw telemetry into the final answer. Summarize counts and quote only short excerpts.

### 4. Compare Raw Input Against Output

Always evaluate the pair, not the output alone:

- Locate the raw user input/source inside `request.userMessage.value` or the route logs: raw transcript, dictated text, thoughts passed into a plan prompt, note content, etc.
- Compare it with `response.parsedOutput.value` field by field.
- Classify each model change:
  - **Good transformation**: cleans dictation, normalizes a spoken reference, fixes obvious transcription spelling, or adds a Scripture citation anchored in a quote/story/event the user actually said.
  - **Over-generation**: adds a sermon main verse from context, adds a thematic Bible reference only because the topic is nearby, inserts a theological bridge/application/conclusion the user did not say, or mutates `originalText`.
  - **Under-generation**: leaves dictated artifacts, misses clear reference normalization, or fails to tag/structure content that is explicit in the input.
- Treat `jsonStructureStatus: success` as only schema success. Domain review starts by asking: "What exactly did the user provide, and what exactly did the model add, remove, or change?"

Grounded citation examples from real telemetry:

- Good: "раб Авраама молился..." → `(Быт. 24:12-14)`.
- Good: "коня готовят на день битвы, но исход от Господа" → `(Прит. 21:31)`.
- Good: "Моисей... Аарон и Ор помогли ему руки держать" → `(Исх. 17:11-12)`.
- Bad: adding the sermon main verse `(Прит. 3:5-6)` when it appears only in prompt context.
- Bad: adding `(Иак. 1:2-4)`, `(Иак. 5:16)`, `(Гал. 6:2)`, `(Евр. 10:24-25)`, or `(Еф. 6:11-17)` from a topic/metaphor without an explicit textual anchor.

### 5. Evaluate Domain Quality

Check domain-specific red flags:

- `thought`: `meaningPreserved=false`, empty tags, wrong language, over-polished text, missing Scripture reference normalization.
- `polishTranscription`: unchanged suspicious text, meaning drift, bad dictated Scripture formatting, failure to flag nonsense.
- `studyNoteAnalysis`: wrong English book mapping, redundant `toChapter`/`toVerse`, missed references, excessive or generic tags.
- `plan_point_content`: wrong heading count, too verbose for scanning, ignores sub-points, wrong language, invents content not in thoughts.
- `sermon_verses`: returns verses already present, wrong JSON key, weak relevance explanations.
- `sermon_directions`: wrong JSON key/shape, vague suggestions, not tied to sermon content.
- `sort_items`: missing items, duplicate item keys, invalid outline/sub-point assignment.
- `speech_optimization`: chunk over 4000 characters, broken sentence boundaries, changed meaning.

### 6. Check Prompt Contract Hygiene

For every candidate issue, verify the full contract:

- System prompt asks for the same keys as the Zod schema.
- User prompt asks for the same keys as the Zod schema.
- `promptVersion` matches the current behavior.
- Dynamic context computed in code is actually injected into the prompt.
- Postprocessing does not silently contradict the prompt.
- Tests assert the prompt version and the important prompt content.

Common silent failure: JSON telemetry is `success`, but the prompt asks for one shape while the schema expects another. The model may still satisfy the schema, but prompt clarity and quality degrade.

### 7. Fix Conservatively

Prefer small changes:

- Align prompt key names with schema.
- Remove contradictory instructions.
- Add missing domain constraints.
- Add deterministic postprocessing only when the rule is objective.
- Add tests for the changed contract.

Avoid broad prompt rewrites unless telemetry clearly shows the prompt is structurally failing.

### 8. Version Rule

Any change that can affect final AI output must increment `promptVersion`.

Examples:

- Prompt wording changes: bump.
- Schema description changes that influence structured output: bump.
- Deterministic postprocessing that changes output: bump.
- Telemetry-only metadata changes: usually no bump.

### 9. Validate

Run targeted tests first:

```bash
npm run test:fast -- --runTestsByPath <relevant test files>
```

Then run scoped lint for changed files:

```bash
npx eslint <changed files>
```

Run TypeScript when prompt/client contracts changed:

```bash
npx tsc --noEmit
```

If full lint or compile fails because of unrelated dirty worktree files, report that explicitly and do not revert unrelated work.

## Admin Review API

Admin endpoints require:

- `ADMIN_SECRET`
- `x-admin-secret: $ADMIN_SECRET`
- Production also requires `ALLOW_ADMIN_TELEMETRY_IN_PRODUCTION=true`

Examples:

```bash
curl -H "x-admin-secret: $ADMIN_SECRET" \
  "http://localhost:3000/api/admin/telemetry"
```

```bash
curl -H "x-admin-secret: $ADMIN_SECRET" \
  "http://localhost:3000/api/admin/telemetry/thought?version=v5&limit=50"
```

Mark a failing example:

```bash
curl -X PATCH \
  -H "content-type: application/json" \
  -H "x-admin-secret: $ADMIN_SECRET" \
  -d '{
    "eventId": "EVENT_ID",
    "quality": "bad",
    "reviewedBy": "admin",
    "issueTypes": ["meaning_not_preserved"],
    "notes": "Output preserved JSON shape but failed domain quality."
  }' \
  "http://localhost:3000/api/admin/telemetry/thought"
```

## Suggested Issue Types

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

## Reporting Format

When reporting to the user, include:

- Prompt inventory summary.
- Firestore sample size and date.
- Findings by severity.
- Concrete files changed, if any.
- Prompt versions bumped.
- Tests/lint/compile run.
- Next telemetry records to review after real usage.
