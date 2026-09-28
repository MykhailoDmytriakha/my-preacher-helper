when: callWithStructuredOutput · zodResponseFormat · beta.chat.completions.parse · structured output · parse AI text · regex on model output · JSON.parse AI response · add an AI prompt · new AI call · buildPromptBlueprint · buildSimplePromptBlueprint · promptBlueprint · promptName · promptVersion · PROMPT_REGISTRY · promptRegistry.test · prompt / schema keys disagree · AI_MODEL_TO_USE · GEMINI_MODEL · OPENAI_GPT_MODEL · workload · structured.speechOptimization · OPENAI_OPTIMIZATION_MODEL · 404 status code (no body) · model not found on Gemini · providerAdapters · runWithFallback · classifyError · requestOptions · maxRetries · AI telemetry · ai_prompt_telemetry · openStructuredTelemetryEvent · emitStructuredTelemetryEvent · config/schemas/zod · .optional() in schema · Gemini hangs then 500 · вызов ИИ · структурированный ответ · схема ответа модели · разбор ответа модели · новый промпт · реестр промптов · модель не найдена · Gemini зависает и отдаёт 500 · телеметрия ИИ

# Call an AI model with structured output

Every text AI call goes through `callWithStructuredOutput` in `frontend/app/api/clients/structuredOutput.ts`, with a zod schema from `frontend/app/config/schemas/zod/` and a `userId` the route has verified. It returns `{ success, data, refusal, error }`; the SDK parses and validates the model's JSON, your code never does.

## How

- Schema: a zod object in its own file under `frontend/app/config/schemas/zod/` (e.g. `thought.zod.ts`) with its type as `z.infer` beside it, exported from `index.ts`. The call sends it as `zodResponseFormat(schema, formatName)` to `beta.chat.completions.parse()`; read `result.data`. Never regex or `JSON.parse` model text.
- Prompt: build a blueprint from named blocks with `buildPromptBlueprint` (`frontend/app/api/clients/promptBuilder.ts`) — each block carries `blockId`, `category`, `source`, `contentHash`, `contentLength` — and pass it as `promptBlueprint` with `promptName` and `promptVersion` (default `v1`).
- Register every `promptName` in `PROMPT_REGISTRY` (`frontend/app/api/clients/ai/promptRegistry.ts`). `frontend/__tests__/api/clients/promptRegistry.test.ts` fails on a name missing from it and on an entry no code uses; a rename keeps history through `legacyNames` / `resolvePromptKey`.
- Contract hygiene: system prompt, user prompt, schema keys and their `.describe()` texts, post-processing and `promptVersion` must agree. Asking for `relatedVerses` while the schema has `verses`, or computing a style directive and never injecting it, loses quality silently while telemetry still says `success`. A number in a field description outweighs the prompt (`frontend/__tests__/api/clients/planStyleOwnsVolume.test.ts`). Any output-affecting change bumps `promptVersion`.
- Provider and model: with a `userId` (every current caller) the target chain comes from the user's tier — `resolveUserTextTargets` in `frontend/app/api/clients/ai/tierPolicy.ts` — and the `model` option is ignored. Without one, `resolveStructuredTargets` in `frontend/app/api/clients/ai/routing.ts` reads `AI_MODEL_TO_USE` per request (`GEMINI` → Gemini, anything else → OpenAI) with `GEMINI_MODEL` / `OPENAI_GPT_MODEL` and returns one `{ providerId, modelId }` pair.
- A different model for one flow on that path: add a `Workload` in `routing.ts` that picks per provider, as `structured.speechOptimization` does (`OPENAI_OPTIMIZATION_MODEL` only when the provider is OpenAI). Don't pass a raw `model`: it replaces the model but keeps the provider, so an OpenAI id reaches the Gemini client.
- Keep the layers apart: clients and error classification in `providerAdapters.ts` (OpenAI, Gemini, OpenRouter — one OpenAI SDK, different `baseURL`), routing in `routing.ts` / `tierPolicy.ts`, catalog metadata in `functionCatalog.ts`.
- Fallback: `runWithFallback` tries the next target on any error `classifyError` does not call `terminal`. The chain holds only the tier's allowed models, so a free user has one.
- Behind a 60 s route wall pass `requestOptions: { timeout: <below the wall>, maxRetries: 0 }` — the SDK defaults (2 retries, 10-minute timeout) outlive the function (`sermon.structured.ts`, `studyNoteCut.structured.ts`).
- In a wrapper that degrades on error, rethrow `isUsageCapReachedError(error)` first — `.howto/gate-and-meter-an-ai-call.md`.

## Telemetry

- `frontend/app/api/clients/aiTelemetry.ts` writes Firestore `ai_prompt_telemetry` (`AI_TELEMETRY_COLLECTION`), only when `FIREBASE_SERVICE_ACCOUNT` is set and never under `NODE_ENV=test`.
- One record, two states: `openStructuredTelemetryEvent` writes `phase: "started"` before the provider call and is awaited on purpose, so a killed function still leaves its input; `emitStructuredTelemetryEvent` settles the same record fire-and-forget. Both swallow their own errors — telemetry never changes the AI result. A record stuck in `started` is a call that never returned.

## When it goes wrong

- `404 status code (no body)`, wrapped by the route as 500 → a model id the chosen provider's endpoint does not serve: an OpenAI id sent to the Gemini client, or a `GEMINI_MODEL` that is not a text chat model (it goes to Gemini's OpenAI-compatible chat endpoint).
- A Gemini call hangs, then 500 or FUNCTION_INVOCATION_TIMEOUT → `.optional()` inside a named strict schema compiles to a self-referencing definition Gemini cannot decode. `frontend/__tests__/api/clients/structuredOutputSchemas.test.ts` checks every schema that reaches a provider — add yours to its list.
- `success: true` but a poor answer → schema success is not quality; `.howto/review-ai-prompt-telemetry.md`.

## Why

- 2026-05-25: speech optimization forced `OPENAI_OPTIMIZATION_MODEL` while `AI_MODEL_TO_USE=GEMINI` → an OpenAI id reached the Gemini client → 404. The per-provider `workload` replaced the override.
- 2026-07-26: compose-plan went down on a cyclic `.optional()` schema (84–108 s then 500, against 12.7 s with a flat schema).

See also: `.howto/gate-and-meter-an-ai-call.md` · `.howto/review-ai-prompt-telemetry.md` · `.howto/diagnose-slow-ai.md`
