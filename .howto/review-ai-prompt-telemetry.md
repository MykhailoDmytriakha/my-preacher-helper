when: prompt telemetry · review a prompt · prompt quality · ai_prompt_telemetry · /api/admin/telemetry · jsonStructureStatus · qualityReview · good bad needs_review · keepAsExample · issueTypes · Review Baselines · prompt version watermark · bump promptVersion · Short vs Detailed look the same · plan volume · over-generation · under-generation · grounded transformation · raw input vs output · schema success is not quality · JSON success · meaningPreserved · dictation quality · user actions as quality signal · regenerate · ai_artifact_feedback · correlationId · request.userMessage.hash · качество промпта · телеметрия промптов · разбор промпта · оценка ответа ИИ · сырой вход против выхода · перегенерация · недогенерация · версия промпта · качество диктовки

# Review AI prompt quality from telemetry

Follow `frontend/docs/ai-prompt-telemetry-review-loop.md`: start from its Review Baselines table (the watermark), pull the current version's newest records through the admin endpoints, read raw input and parsed output as a pair, label them, fix, bump `promptVersion`, move the watermark.

## How

- Scope: the Review Baselines table holds the last reviewed version and window per prompt. Review the current version and newer records only; older versions are history or regression comparison. No new records → say so and stop. Update the table in the same change as the version bump — and also when nothing changed, so the next review does not repeat the slice.
- Access: `GET /api/admin/telemetry` (summary by prompt → version), `GET /api/admin/telemetry/[promptName]?version=&quality=&examples=true`, `PATCH` there to label. Needs an admin account's bearer (`requireAdminEmail`); off in production unless `ALLOW_ADMIN_TELEMETRY_IN_PRODUCTION=true`. Names are registry keys; `resolvePromptKey` folds old names (`plan_point_content` → `sermon.conspect.point`).
- Two outcome layers: `jsonStructureStatus` is the provider/schema result (`success`, `refusal`, `error`, `invalid_response`); `qualityReview.quality` is the human/domain result (`unreviewed` by default, `good`, `bad`, `needs_review`). Iterate on reviewed examples per version, not on JSON success counts.
- Pair first: read `request.userMessage.value` (the raw transcript or input) against `response.parsedOutput.value`. Classify the delta — grounded transformation, over-generation (context, verses or applications not in the source), under-generation (speech artefacts left, a clear reference not normalized) — before changing the prompt. Label with `issueTypes`; keep good ones with `keepAsExample`.
- "Short vs Detailed look the same": compare `sermon.conspect.point` records with the same `request.userMessage.hash` and outline point across styles (`request.context.style`). The style is there but the difference is small → the prompt's volume contrast is weak, not UI state loss. Check the count is stated in one place: a count in a schema `.describe()` beats the prompt (`frontend/__tests__/api/clients/planStyleOwnsVolume.test.ts`).
- Dictation: `success` proves only the provider and schema. Judge the chain STT → polish/thought → persistence by domain outcomes: `meaningPreserved=false`, polish that changed nothing, a transcript that looks corrupted. Transcription itself is not in `ai_prompt_telemetry`; the endpoint side (`generationMeaningPreserved`, `usedFallback`, phase timings) is in `api_performance_telemetry`.
- The two streams are not joined today: `createApiPerformanceTracker` makes its own `correlationId`, and no route passes one in `logContext` (`inferCorrelationId` in `frontend/app/api/clients/aiTelemetry.ts` would read `correlationId` / `requestId` / `traceId`). Wire one through before correlating per request.
- What people do after generation — regenerate, save unchanged, save after edits, reject a suggested field, delete soon after creation — is a quality signal only when the artifact carries provenance (`eventId` / `correlationId` / `promptVersion`). Store it apart from prompt telemetry, graded by polarity + confidence, not binary good/bad. Designed in `frontend/docs/ai-behavior-feedback-telemetry.md`; not built yet — no code writes `ai_artifact_feedback`.

## Why

- 2026-04-25: schema success was being read as quality; the loop got raw-vs-output pairing, review labels and a version/date watermark.
- 2026-05-19: Short vs Detailed felt unchanged although the style reached the prompt — the volume contrast was the problem.

See also: `.howto/call-ai-with-structured-output.md` · `.howto/diagnose-slow-ai.md`
