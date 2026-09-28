when: AI usage metering · quota not counted · usage limit · usage cap · UsageCapReachedError · USAGE_CAP_REACHED · 429 usage cap · usageCapResponse · createUsageAdmission · usageAdmission · isUsageAdmitted · assertAiUsageAvailable · consumeAiUsage · consumeTranscriptionSeconds · consumeAudioSeconds · bearer token on AI route · getRequiredAuthenticatedUid · getAuthenticatedRequestHeaders · Authorization: Bearer · 401 on AI route · optional auth bypass · tier allowlist · model not allowed for this tier · effective tier · resolveEffectiveTier · entitlement · /api/me/entitlement · model preference ignored · explicit model override · preferredText · preferredTts · preferredTranscription · per-function model preference · functionCatalog · TIER_LIMITS · paid model after downgrade · лимит использования · учёт расхода ИИ · квота · тариф · доступ к модели по тарифу · токен авторизации · 401 на маршруте ИИ · выбор модели игнорируется · лимит исчерпан

# Gate and meter an AI call

A route that spends AI verifies the caller's Firebase bearer token first, admits the whole user action once, passes the trusted `uid` into every provider call, and counts each successful use. The pieces are `frontend/app/api/auth/requireAuthenticatedUid.server.ts`, `frontend/app/services/usageLimits.server.ts` and `frontend/app/api/clients/ai/tierPolicy.ts`; a complete example is `frontend/app/api/thoughts/transcribe/route.ts`.

## How

- The chain on every provider path: server-trusted uid → assert before the provider → provider success → consume. A shared client with an optional unmetered branch is not enough on its own.
- Auth first: `getRequiredAuthenticatedUid(request)` returns `null` → 401, before `request.formData()` / `request.json()` or any processing. Ownership (403) after loading the document.
- Admission: `createUsageAdmission(uid, entitlement, ['transcription', 'ai'], now)` checks every resource the action needs once, at the route, and throws `UsageCapReachedError` if one is blocked. Pass the returned `usageAdmission` down; `callWithStructuredOutput` skips its per-call assert when `isUsageAdmitted(...)`, so retries and later steps of an admitted action are not blocked half-way.
- Metering is per successful use: `consumeAiUsage` inside `callWithStructuredOutput` after a parsed answer, `consumeTranscriptionSeconds` after the transcript, `consumeAudioSeconds` with the length measured from the generated audio (`getMeteredAudioDurationSeconds`). Every structured-output call passes `userId`; without it nothing is metered or tier-gated.
- A cap error is never degraded: each wrapper with a graceful fallback rethrows first — `if (isUsageCapReachedError(error)) throw error;` — and the route answers `usageCapResponse(error)`: 429 with the machine payload from `toUsageCapErrorPayload` (code, resource, used, limits, `resetsAt`) and no message text. The client rebuilds it with `parseUsageCapError`.
- Model choice: TEXT targets come only from effective tier × allowed preference (`resolveUserTextTargets`); with a trusted `userId` the legacy `model` override is ignored. Free = the configured default only; paid tiers = that function's catalog (`createTierModelPolicy`). A stored preference is a preference, never a privilege grant.
- One server catalog: `frontend/app/api/clients/ai/functionCatalog.ts` (functions `text`, `transcription`, `tts`), admin defaults in Firestore `config/aiModelDefaults` (`aiModelDefaults.server.ts`). `/api/me/entitlement` reads the uid from the bearer (no caller-supplied uid) and returns per function `available` (allowed rows only) and `current` chosen from `available`, so a saved paid choice does not survive a downgrade or an expired promotion. The UI may show locked catalog rows; execution never trusts them.
- Audio models: authorize the exact catalog `{providerId, modelId}` against the tier before mapping it to a runtime id — `getAllowedTtsSelection`, then `getGoogleModel` in `frontend/app/api/sermons/[id]/audio/generate/route.ts`. TTS never substitutes another model on failure; the error names provider/model. Transcription may fall back only within the tier's allowed transcription models (`resolveTranscriptionModels` in `openAI.client.ts`).
- After saving a per-function preference, invalidate entitlement as well as settings (`frontend/app/hooks/useUserSettings.ts`, prefix `['me', 'entitlement']`) so the selectors and execution show the same server-resolved `current`.
- Load entitlement lazily: `callWithStructuredOutput` and `resolveTranscriptionModels` `import()` the `.server` entitlement modules only inside the `userId` branch, so no-user paths never load Firebase Admin.
- Transport: a route that enforces only when a uid is present is fully bypassable while callers send no token. Audit every live caller and attach `getAuthenticatedRequestHeaders()` (`frontend/app/utils/authenticatedRequest.ts`): it returns `{}` only when signed out and rejects if the token fetch fails (fails closed). Transcription uses `getTranscriptionAuthorizationHeaders`, which throws without a user.

## Traps

- TTS export admits only on the first batch (`offset === 0`); a crafted `offset > 0` skips admission — an accepted, documented risk in the route.

## Why

- 2026-07-12: the tier allowlist was bypassable while the legacy explicit-model override stayed live on the user-aware path, and an eager entitlement import pulled Firebase Admin into TTS/transcription imports.
- 2026-07-12: an optional-auth quota gate shipped while production callers sent no bearer, so nothing was enforced.
- 2026-07-15: per-call quota checks blocked retries of an action that had started legitimately, and generic degradation catches turned a cap error into success.

See also: `.howto/call-ai-with-structured-output.md` · `.howto/generate-sermon-audio.md` · `.howto/record-and-transcribe-audio.md`
