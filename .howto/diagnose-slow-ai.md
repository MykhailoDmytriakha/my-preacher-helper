when: AI is slow · dictation slow · slow thought creation · slow transcription · latency by provider/model · phase timings · api_performance_telemetry · createApiPerformanceTracker · timePhase · transcribe_audio · generate_thought · polish_transcription · persist_thought · p90 latency · measure-ai-latency · phase started never finished · AI cost · token usage · completionTokens · cheaper model · swap provider for one flow · AI_MODEL_TO_USE flip · ИИ тормозит · медленная диктовка · медленная транскрибация · долго создаётся мысль · задержка по фазам · замер скорости · стоимость ИИ · расход токенов · модель подешевле · сменить провайдера

# Diagnose slow or expensive AI

Measure before changing anything. Endpoint time by phase is in Firestore `api_performance_telemetry` (`frontend/app/api/clients/apiPerformanceTelemetry.ts`, reading guide `frontend/docs/api-performance-telemetry.md`); model latency and tokens per call are in `ai_prompt_telemetry`. Find the phase that owns the time, split it by provider/model/version, then change only that flow.

## How

- Phase share first: `createApiPerformanceTracker` + `tracker.timePhase(...)` record total `durationMs` and each phase for `POST /api/thoughts` (`transcribe_audio`, `generate_thought`, `persist_thought`, …) and the two `transcribe` routes (`polish_transcription`). If `generate_thought` / `polish_transcription` owns 80–90 % of server time, faster speech-to-text will hardly be felt unless it removes or streams the second phase. The number of serial AI calls says less than the share.
- A slow flow without numbers → add the tracker to its route. Context stays numeric and safe (sizes, durations, counts, flags) — never raw audio, transcript or model text. It is best-effort and needs `FIREBASE_SERVICE_ACCOUNT`.
- Split model time by `provider`, `model` and `promptVersion` of the same prompt family, with `usage.completionTokens`, before blaming prompt length, endpoint code or STT. The admin summary groups by prompt → version only, and `frontend/scripts/measure-ai-latency.mjs` (read-only: n / median / p90 / max and the share over 10 s) by prompt only — do the provider/model split on the raw records.
- Records stuck in `phase: "started"` are calls that never returned (killed at the route's `maxDuration`); a latency view that drops them understates the tail.
- Cost: read real prompt/completion usage before swapping providers. Once rewriting runs on a budget model, transcription dominates the cost of voice flows, so savings come from routing, prompt shrinkage and fallback escalation, not one model for everything (`frontend/docs/model-cost-writing-research-2026-02-28.md`: `thought@v3` used 38.9 % fewer tokens than `thought@v1`).
- Swap per flow, never globally: `AI_MODEL_TO_USE` and the admin text default in `config/aiModelDefaults` move every structured flow at once. There is no per-flow text routing on the user path today — every call with a `userId` resolves the same TEXT target (`resolveUserTextTargets`), and `Workload` in `frontend/app/api/clients/ai/routing.ts` steers only calls without a user. A fast-model A/B for polish or thought needs a per-flow target added there first.
- Server time is not felt time: upload, download and render are not measured. Server numbers fine but the UI slow → add a client event around `createAudioThought()`.

## Why

- 2026-04-25: prompt telemetry explained output quality but not why dictation felt slow; endpoint phase telemetry was added.
- 2026-04-30: aggregates across providers hid which model was slow; phase share and a provider/model/version split pointed at the slow part.
- 2026-02-28: cost research showed transcription dominating once the rewrite ran on a budget model.

See also: `.howto/call-ai-with-structured-output.md` · `.howto/review-ai-prompt-telemetry.md` · `.howto/raise-route-time-limit.md`
