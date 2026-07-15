# BUGS.md — трекер багов

> **Правило:** сломано/неверно → сюда (open, с якорем `file:line` + severity P1/P2). «Хорошо бы добавить» → `FEATURE_CONCEPTS.md`. Починил → перенеси в «Исправлено» кратко (детали живут в git-истории и памяти, не дублируем сюда).

---

## 🔴 Открытые баги — нужно починить

### B9 · TOCTOU перебора usage-лимита при конкурентном burst — P1
**Суть.** Проверка лимита и его инкремент — РАЗНЫЕ шаги. `assertAiUsageAvailable` читает-проверяет ДО провайдер-вызова, `consumeUsage` инкрементит ПОСЛЕ отдельной транзакцией, БЕЗ ре-проверки (`usageLimits.server.ts:105`, `:120` слепой `current+amount`). Два одновременных запроса на 99/100 оба проходят check → оба исполняются → usage уходит за квоту.
**Масштаб — СИСТЕМНЫЙ, 5 потребителей одного примитива:** `structuredOutput.ts:280`, `audio/generate:380`, `studies/transcribe:145`, `thoughts/route:233`, `thoughts/transcribe:144`.
**РЕАЛЬНЫЙ ИМПАКТ (оценка 2026-07-14).** Бьёт только при ИСТИННОЙ одновременности (окно check→increment = мс). Последовательные вызовы считаются корректно (каждый перепроверяет). Обычный UI-юзер: перерасход ~0; две вкладки/двойной клик → 1-2; целенаправленный параллельный burst → больше, но каждый жжёт реальный вызов провайдера и **самоограничивается** (после лимита всё блокируется). Малая база + щедрые квоты (100–5000) → **P1 по классу, но НЕ срочно**; чинить при работе над примитивом, не пожар.
**РЕФРЕЙМ (владелец 2026-07-14): грация, не жёсткий блок → фича.** Владелец НЕ хочет атомарного блока ровно на лимите. Пример: транскрибация = 2 списания (STT+полировка) → одно действие на 99 даёт 101, и это ОК «по благодати». Нужно: (1) действие ДОигрывается (не падает на полпути), (2) мягкий блок НОВЫХ действий за лимитом, (3) hard-cap на бо́льшем пороге (напр. limit+10%), (4) в настройках/админке при перерасходе — тёплое сообщение + СТИХ про благодать. ⇒ B9 из «гонки на устранение» → в **grace-band фичу** (`FEATURE_CONCEPTS.md` F7). Атомарность перестаёт быть критичной (малый overshoot — by design); остаётся hard-cap + сообщение.
**Фикс (направление, из Popper-петли):**
- **Дискретный `aiUsed` (+1, известен заранее):** atomic **reserve+refund ДО провайдера** (проверка+инкремент в одной `runTransaction`; бросок → 429 ДО стрима; refund при провале провайдера). ⚠️ простой rethrow НЕ проходит: `callWithStructuredOutput` (17 вызовов через 8 wrappers) глотает исключение в `{success:false}`/`[]`/500 — надо явно мапить `UsageExhaustedError`→429 на границе роута.
- **Seconds-метры (transcription, audio — сумма известна ПОСЛЕ):** assert(оценка) ДО + consume-actual ПОСЛЕ, БЕЗ throw (иначе после успешной генерации 500 → повторная оплата провайдера). Минимальный overshoot при burst допустим (щедрые квоты). Reserve-before НЕ рекомендован (плохо стыкуется с audio per-batch, риск refund-on-crash).

### RMW-класс · lost-update read-modify-write вне транзакции — P1 (первазивный, ≥9 сайтов)
**Суть.** Код читает документ, фильтрует/меняет ВЕСЬ массив в памяти из stale-read и `writeBatch`/`update` перезаписывает его целиком. `writeBatch` ≠ read-isolation → при конкурентном same-owner редактировании между read и commit правка теряется (или остаётся dangling-ссылка). Это НЕ точечный баг — это паттерн по всему коду.
**Сайты:**
- `series.repository.ts:112` (sermon-DELETE, detach серий) · `series.repository.ts:139` (удаление группы, live из `groups/[id]/route.ts:33`)
- `series/[id]/route.ts:41` + `:61-67` (detach при concurrent move очищает свежий `seriesId`)
- `studies.repository.ts:30` (`deleteNote`) · `studies.repository.ts:120` (`updateMaterial`, cross-doc RMW)
- `firestore.client.ts:112` / tag-cascade → перезапись целых stale `thoughts`
- `sermons.repository.ts:320` → перезапись целого `preachDates`
- `audio/chunks/[index]/route.ts:38` → перезапись целого `audioChunks`
**РЕАЛЬНЫЙ ИМПАКТ (оценка 2026-07-14).** Реальная гонка, но НИЗКАЯ вероятность (нужны 2 write на один док в окне ~<1с от одного владельца). Самый реалистичный триггер — **офлайн-буфер записи доигрывается при reconnect, пока юзер правит вживую**; реже — две вкладки/двойной клик. Вред — тихая потеря правки / dangling. **НЕ делать big-bang по всем 9.** Cherry-pick «дёшево + горячий путь»: ✅ `deleteNote`, series detach (`arrayRemove` почти drop-in) · ⏸️ оставить known-risk: `updateMaterial` cross-doc, tag-cascade, preachDates (редко + дорого, нужна общая транзакция).
**СЛОЖНОСТЬ ФИКСА (оценка 2026-07-14).** Одиночный-док RMW → `runTransaction`/`arrayRemove`: **низко, ~30-60 мин/сайт** (фидлится только реалистичный concurrency-тест). Cross-doc (`deleteNote`+`updateMaterial` в одной транзакции через 2 коллекции): **средне-высоко, ~1-2 дня**. Итог: 2-3 дешёвых на офлайн-пути ≈ **полдня**; весь класс ≈ **2-3 дня**.
**Фикс.** `runTransaction` (read-modify-write внутри) ИЛИ `FieldValue.arrayUnion/arrayRemove` где достаточно операции над элементом (шаблон уже в репо: `studies.repository.ts:88,98`). ⚠️ `deleteNote`+`updateMaterial` — arrayRemove НЕ закрывает race (concurrent add после query → dangling), нужна ОБЩАЯ transactional isolation обоих путей.

### Audio-метринг · неверный учёт озвучки — P1/P2 (фикс = full-stack фича)
**B6 перекос списаний по провайдеру (P1-по-импакту — бьёт на КАЖДОМ OpenAI-экспорте).** Чанки режутся одинаково, но число HTTP-запросов разное: Google = **1 запрос** (сервер регруппирует, `StepByStepWizard.tsx:524`), OpenAI = `ceil(чанки / 3)` запросов (`GENERATION_BATCH_SIZE=3`, `:535`). А `consumeAiUsage` = **+1 за КАЖДЫЙ запрос** (`route:380`). Итог: 15 чанков → OpenAI **5 списаний**, Google **1**. Это главный реальный кусок.
**B7 провал чанка (P1 по классу, но РЕДКИЙ).** Retry в аудио-пути НЕТ (`generateChunkAudio` кидает при провале; `Promise.all` fail-fast, `route:377`; retry есть только у МЫСЛЕЙ `thought.structured.ts`, не тут). Упал чанк → батч падает → экспорт падает, файла нет, а ранние батчи уже списаны → заплатил за неполученное. Частота низкая (ошибка провайдера / чанк >4096).
**Batch-snapshot (near-theoretical, НЕ чиним пока не увидим).** `route:205` перечитывает `audioChunks`, браузер шлёт offset из раннего снапшота (`StepByStepWizard.tsx:503`) → правка текста РОВНО во время секундного авто-цикла батчей. Практически невозможно (между батчами нет действий юзера). Оценка 2026-07-14: переоценено, понижено.

### Audio-export UI · Free видит одну модель + «качество» вводит в заблуждение — P2 (UX, скрин 2026-07-14)
**(a) Free показывает только OpenAI/gpt-4o-mini-tts.** Каталог TTS = 3 модели (`functionCatalog.ts:31-33`: Google gemini-3.1-flash-tts [default], Google gemini-2.5-flash-tts, OpenAI gpt-4o-mini-tts), но wizard сидит из entitlement (`StepByStepWizard.tsx:225-236`) и пиннит free к единственной дозволенной; роут гейтит по tier (403 «not allowed for this plan», `route.ts:244`). Владелец: free должен хотя бы ВИДЕТЬ другие провайдеры/модели (upsell), а не одну. → часть **F1** (per-tier выбор моделей) в `FEATURE_CONCEPTS.md`.
**(b) «Стандартное / Высокое качество» у gpt-4o-mini-tts — мёртвый toggle + неверно.** `quality` (`StepByStepWizard.tsx:186,741`) на OpenAI-пути НЕ меняет модель: wizard хардкодит `model: OPENAI_TTS_MODEL='gpt-4o-mini-tts'` (`:515`), роут берёт `selectedModel = requestedTarget.modelId`, игнорируя `quality` (`route.ts:258-261`). Легаси `getTTSModel(standard→gpt-4o-mini-tts, hd→tts-1)` не используется, и tts-1 — СТАРЕЕ, не «выше качеством». Концептуально: качество даёт РАЗНАЯ МОДЕЛЬ, не тумблер у одной. Фикс: убрать toggle ИЛИ связать с реальным выбором модели (в рамках F1).
**РЕШЕНИЕ ВЛАДЕЛЬЦА (2026-07-14).** Считать по ДЛИТЕЛЬНОСТИ реально сгенерированного аудио (секунды), суммарно по чанкам, **только успешные**. Растворяет B6 (additive-by-work) + B7 (частичный провал честен) by construction.
**Фикс = full-stack фича:** новое измерение `audioSecondsPerPeriod` в `tierPolicy.ts` + `audioSecondsUsed` в usage; длительность через `music-metadata` (уже установлен, `audioServerUtils.ts:7`); worker-pool с per-chunk status (не blanket `allSettled`, не отдавать усечённый batch как готовый); `Promise.allSettled`; +8 поверхностей entitlement (нормализация, `/api/me/entitlement`, `useUserEntitlement`, usage-виджет, admin-схема, клиентский гейтинг). **Owner-решения при старте:** значения тарифов, политика частичного провала экспорта, приемлемость текст-оценки как fallback.
**СТАТУС (2026-07-14, автономная audio-фича, деплой):** ~~B6 двойной счёт~~ **ИСПРАВЛЕН** (`consumeAiUsage` 1/экспорт; бонус — закрыт пред-существующий OpenAI-списание-на-каждый-батч). **B7** — метринг чинён (allSettled + сумма успешных секунд через `audioDurationMetering.server.ts` fail-closed); остаётся отложенным «тихая потеря чанка OpenAI» (продуктовое решение → `FEATURE_CONCEPTS.md` F8). audioSecondsUsed метрится, но НЕ энфорсится (билинг отложен; интерим-кэп = 1 aiCall/экспорт). Google-1750-путь за флагом `GOOGLE_SMALL_CHUNKING` (live-слух не сделан). batch-snapshot — near-theoretical, не трогаем.

---

## 🟡 Открыто, но не «код-фикс»

### referral Sybil — фейк-аккаунты стакают промо — P1 (PLAUSIBLE) → фича F6
**Механика.** Награда = +30 дней tier1 за КАЖДОГО зарегавшегося+заклеймившего, кумулятивно (`referral.server.ts`, `computeReferralPromotion:25-29`). Защищает: email_verified + аккаунт <24ч + клейм один раз + не self-referral. Sybil стоит: N верифиц. email + N аккаунтов за 24ч.
**Решение владельца:** не авто-блок, а human-in-the-loop → **фича F6 в `FEATURE_CONCEPTS.md`** (на 3-м реферале warning-флаг + письмо владельцу + контрол «отключить промо» в админке). Здесь — как открытая security-заметка; сам фикс живёт в F6.

### purge legacy share-links — data-cleanup (не код-баг)
Код-ревалидация уже сделана (`share/notes/[token]` GET ревалидирует `note.userId===shareLink.ownerId`). Остаётся разовая **чистка невалидных legacy share-links** в проде (data-операция, не код).

### env-var cleanup — гигиена (НЕ баг)
Аудит Vercel-переменных + прочистка мёртвых `#`-строк в `.env.local` + `.env.example`. **НЕ трогать значения секретов/ключей.** Детали → `FEATURE_CONCEPTS.md` → C1.

---

## ⚪ Осознанно НЕ чиним (решения владельца)
- **share/notes viewCount** инкремент (`share/notes/[token]/route.ts:34`) — аноним накручивает чужой счётчик-тщеславие, ноль импакта.
- **share-links GET mismatch** (`share-links/route.ts:16`) — игнорит mismatched query `userId`, но возвращает СВОИ линки звонящего, не жертвы → не уязвимость, косметика.

---

## ✅ Недавно исправлено (кратко; детали — git-история + память)
- **Track A эпика fix-all-bugs (2026-07-14, НЕ закоммичено):** B1 escape всех user-полей в письме · B2 email из верифиц. токена · B3 image/payload client+server guard · B4 feedback rate-limit (sliding-window) · B5 admin/telemetry `requireAdminEmail`. tsc 0 · lint 0 err · test:fast 3709.
- **Deploy S2 app-wide auth hardening (2026-07-14):** bearer→uid(401)+ownership(403)+метринг по uid на ~47 AI/mutation-роутах; studies/analyze; feedback POST auth; materials↔notes cross-write; sermon DELETE series-cleanup атомарность (residual read-isolation → см. RMW-класс выше). Сводка → [[project_appwide_auth_hardening]].
- **UI/i18n серия (ранее):** БАГ-1..15 — переводы статов/счётчиков, русская плюрализация, локализация дат, line-clamp сниппетов, порядок плана в мобильном, цветовой тинт карточек серий, предзаполнение форм. Все закрыты, детали в git.
