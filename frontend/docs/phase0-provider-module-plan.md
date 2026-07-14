# Фаза 0 — Единый модуль выбора провайдера/модели (ратифицированный план)

> Ратифицировано через Plan-механизм Mike: ⭕📐Ohno-черновик → 🔭❓Hamming+🛡️⚔️Popper (Codex gpt-5.6-sol/high, 1 раунд, 8 находок адресованы). Делиберация-лог: `~/.claude/skills/mike/.plans/my-preacher-helper/2026-07-11_23-10_phase0-provider-module.md`. Часть эпика — см. `feature-concept-tiers-and-model-selection.md` §7,§9.

## Что делаем (и чего НЕ делаем)
**Делаем:** развязать выбор провайдера/модели от исполнения; убрать дубль резолвинга; заложить ШОВ для per-user + fallback + OpenRouter — **не активируя** их. Env-based per-request резолвинг.
**НЕ делаем в Фазе 0** (Popper-границы): активный fallback (меняет поведение → Фаза 3), per-user резолвинг (нет UID-плумбинга → отдельная auth-фаза), TTS/транскрибация (иной контракт), удаление `AI_MODEL_TO_USE` (только явной compat-миграцией).

## Целевая архитектура (Hamming Alt A — три плоских концерна)
Новый модуль `frontend/app/api/clients/ai/` (мелкие файлы, не расширять `structuredOutput.ts`):
- **`ProviderId`** — ОДИН канонический union/const, общий источник для всего (реестр · таргеты · **телеметрия** · тесты). Сегодня `openai|gemini`; добавить `openrouter` = правка ЭТОГО источника + одна запись адаптера.
- **`providerAdapters`** (`Record<ProviderId, {client, classifyError}>`) — плоская readonly-мапа: OpenAI-совместимый клиент (base-URL+key) + классификатор ошибок провайдера → диспозиция `terminal | retrySameProvider | tryNextTarget`.
- **`ModelTarget = { providerId, modelId }`** — атомарная пара, что реально исполняется.
- *(Каталог моделей для UI-селектора — ОТЛОЖЕН в Фазу 4: `modelCatalog`/`ModelSpec` метаданные строятся там, где их потребляет селектор, с динамической формой. В Фазе 0 не нужны — YAGNI.)*
- **`routingPolicy`**: `resolveStructuredTargets({ workload, trustedContext? }) → ModelTarget[]`. **Фаза 0 возвращает РОВНО ОДИН таргет** (из env-маппинга). Ключ — **workload** (`structured.default`, `structured.speechOptimization`), НЕ грубый `capability`.
- **`structuredOutput`** — ИСПОЛНЯЕТ готовый `ModelTarget` (берёт клиент по `providerId`, зовёт с `modelId`); НЕ знает env/tier/каталог/лейблы.

## Шаги (срезы ✂️✅Beck — каждый проверяем; поведение идентично)
- **S1** — `ai/providerId.ts` + `ai/providerAdapters.ts`: канонический `ProviderId`, адаптеры openai/gemini (клиенты как сейчас). ✔ tsc. *(modelCatalog отложен в Фазу 4.)*
- **S2** — `ai/routing.ts`: `resolveStructuredTargets({workload})` из env-маппинга (**сохранить**: без `AI_MODEL_TO_USE` → OpenAI; `=GEMINI` → Gemini). Возврат ОДНОГО таргета. Workloads: `structured.default`, `structured.speechOptimization`. ✔ unit: маппинг воспроизводит текущее.
- **S3** — граница попытки в `structuredOutput`: принять `ModelTarget`; клиент по `providerId` per-target (чинит глобальный `aiAPI`). Внутренний attempt может throws typed-fail; public-boundary по-прежнему возвращает `StructuredOutputResult`. ✔ существующие structured-вызовы зелёные.
- **S4** — call-sites на **workloads**: убрать локальный `aiModel` дубль (`openAI.client.ts:43-61`), speech-opt (`:58-62`) → `structured.speechOptimization` (спец-модель сохранена). ✔ tsc + test:fast.
- **S5** — **телеметрия** (`aiTelemetry.ts:35-41,70-73`): `provider` принимает канонический `ProviderId` (не закрытый union) + исполненный таргет. ✔ телеметрия компилится с 3-м провайдером (без активации).
- **S6** — диспозиции ошибок в адаптерах (`terminal|retrySameProvider|tryNextTarget`) — ОПРЕДЕЛИТЬ типы, оставить runner одно-таргетным (без active failover). ✔ unit классификации (вкл. `insufficient_quota → tryNextTarget`).
- **Гигиена (C2):** убрать `// This should be 'o1-mini'` (`openAI.client.ts:44`).

## Инвариант приёмки
Поведение идентично (env-маппинг сохранён, вкл. OpenAI-когда-unset), `tsc --noEmit` + `test:fast` зелёные, дубль резолвинга устранён, `ProviderId` канонический сквозь телеметрию, шов (1 активный таргет + типы диспозиций) готов для Фаз 2/3, TTS/транскрибация не тронуты.

## Executor (делегирование по A2)
Планирование — Claude (Mike). **Имплементация S1–S6 → делегируется Codex** (чётко-очерченная задача по готовому плану). Финальный cross-check — dual review (Codex + Claude-субагент) перед маркировкой готовым.
