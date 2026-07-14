## Исправлено

- ~~В сериях можно добавить группу, но в группах нельзя добавить в серию.~~ — **Исправлено**: на странице группы появилась кнопка «Назначить в серию» когда серия не назначена.
- ~~БАГ-1: Статы на странице списка серий не переведены~~ — **Исправлено**: добавлены ключи `workspaces.series.stats.*`, `filter.allStatuses`, `sort.*` во все 3 локали; компонент использует `t()`.
- ~~БАГ-2: Счётчик «N проповедей(ей)» в шапке серии неверен при смешанном содержимом~~ — **Исправлено**: ключ изменён на `workspaces.series.detail.itemCount` («N элемент(ов)»).
- ~~БАГ-3: «N sermons» не переведено в модальном окне «Изменить серию»~~ — **Исправлено**: `SeriesSelector` теперь использует `t('workspaces.series.detail.sermonCount', { count })`.
- ~~БАГ-4: «days» не переведено в Аналитике календаря~~ — **Исправлено**: добавлен ключ `calendar.analytics.daysUnit` («дн.»); компонент использует `t()`.
- ~~БАГ-5: Противоречивые статы «Проповеди» vs «Всего проповедей» в деталях серии~~ — **Исправлено**: 5-й стат переименован в `workspaces.series.detail.conductedMeetings` («Проведено встреч»).
- ~~БАГ-6: Скобочная плюрализация вместо правильных русских форм~~ — **Исправлено** ✓ (проверено в браузере): «1 проповедь», «3 проповеди», «0 групп» — корректные формы.
- ~~БАГ-7: Дата «Jan 30, 2026» на дашборде не локализована~~ — **Исправлено** ✓ (проверено в браузере): «30 янв. 2026 г.» — русский формат.
- ~~БАГ-8: Текст мысли в карточке проповеди не обрезается~~ — **Исправлено**: добавлен `line-clamp-3` к тексту сниппета в `SermonCardSnippets`.
- ~~БАГ-9: «Проповеди в этой серии» — misleading label для первого стата~~ — **Исправлено** ✓ (проверено в браузере): стат «Всего элементов: 3».
- ~~БАГ-10: Статус нельзя выбрать при создании серии~~ — **Исправлено** ✓ (проверено в браузере): в форме «Новая серия» появилось поле «Статус» с выпадающим списком.
- ~~БАГ-11: Поля серии не предзаполняются в форме редактирования~~ — **Исправлено**: единый `formEditedRef` + `useEffect([series])` в `EditSeriesModal` синхронизирует все 5 полей (title, description, bookOrTopic, color, status) из пропа при фоновом рефетче, пока пользователь не начал редактировать.
- ~~БАГ-13: ConductPreflight не подтягивает durationMin блоков~~ — **Исправлено**: добавлены `useEffect` + `useRef` (dirty-флаг) в `ConductPreflight` — localFlow синхронизируется из flow-пропа при обновлении фоновым рефетчем, пока пользователь не начал редактировать длительности.
- ~~БАГ-12: «Мая 26» вместо «Май 26» в аналитике календаря~~ — **Исправлено** ✓ (проверено в браузере): «Май 26», «Июнь 26», «Июль 26» — именительный падеж.
- ~~БАГ-14: в мобильном режиме перенести секцию плана в проповеди до мыслей.~~ — **Исправлено**: применено решение на основе TRIZ+IFR. Использованы Tailwind CSS-утилиты `order-1`, `order-2` в десктопном и мобильном grid-контейнерах для инверсии порядка отображения без изменения структуры DOM. В десктопе порядок остался прежним.
- ~~БАГ-15: Карточки серий выглядят одинаково (нет цветового различия несмотря на цветную точку)~~ — **Исправлено**: фон каждой карточки теперь получает мягкий тинт из `series.color` через `hexToRgb` (светлый режим: 7% прозрачность + 28% граница; тёмный режим: дополнительный оверлей 13%).

---

## Открытые баги

### ~~БАГ: кража чужой AI-квоты через чужой sermonId (P1 · griefing)~~ — **ИСПРАВЛЕНО (2026-07-14, deploy S2 app-wide auth hardening)**
**Был.** Расход AI-лимита/транскрибации считался против `sermon.userId` (server-trusted), а caller не сверялся с владельцем на всех путях → знающий чужой `sermonId` мог сжечь чужую квоту (griefing).
**Фикс.** App-wide `bearer→uid`: каждый AI/mutation-роут теперь `getRequiredAuthenticatedUid`(401) + ownership `resource.userId===uid`(403) + метринг по verified `uid`. Детали → раздел «Deploy S2» ниже + [[project_appwide_auth_hardening]].

### БАГ: двойной счёт AI-квоты при озвучке (per-batch) — P2 · pre-existing (не F1)
**Контекст.** Экспорт аудио браузер бьёт на батчи (под 60s-лимит Vercel), каждый батч = отдельный POST в `audio/generate`, и каждый зовёт `consumeAiUsage` один раз (`generate/route.ts:378`). Генерация из N чанков = несколько батчей = **несколько списаний AI-квоты за ОДНУ озвучку**.
**Эффект.** Пользователь списывает больше, чем должен (over-count). Не безопасность — честность метринга (юзер переплачивает квотой).
**Фикс (направление).** Считать одну озвучку как ОДНО потребление (метрить на уровне всей генерации, не батча), либо дедуп по sermonId+сессия. Батчинг был до F1 → пред-существующее; поймано независимым Popper на F1.

### ~~studies/analyze без auth — worst-case класса «charge по чужому id»~~ — **ИСПРАВЛЕНО (2026-07-14, code-review S2)**
Аноним (без токена) слал `{content:свой, studyId:чужой}` → роут метрил по `study.userId` (жертва) и гнал ЕЁ платную модель на произвольном тексте → бесплатный премиум-AI + слив чужой квоты. Оба кросс-провайдерных ревьюера поймали (CONFIRMED). **Фикс:** `getRequiredAuthenticatedUid` (401) + ownership `study.userId===uid` (403) + метринг по caller `uid`; клиент шлёт `Bearer`. +2 теста (401/403). **Класс на ОСТАЛЬНЫХ AI/mutation-роутах (insights×4, brainstorm, audio, sort, plan, thoughts, materials, notes, prayer, tags, series, groups …) — ЗАКРЫТ в deploy S2 (app-wide bearer→uid; см. раздел «Deploy S2» ниже).**

### БАГ: TOCTOU перебор usage-лимита при конкурентном burst — P1 · pre-existing residual
**Контекст.** `usageLimits.server.ts:105` проверяет лимит ДО провайдер-вызова, инкремент — отдельной транзакцией ПОСЛЕ, без ре-проверки. Одновременные запросы на 99/100 все проходят check → все исполняются → usage уходит за квоту. Поймано code-review (Codex, CONFIRMED).
**Фикс.** Атомарный check+reserve в ОДНОЙ транзакции ДО провайдер-вызова, settle/refund на ошибке.

### БАГ: admin/telemetry на старом static-secret мимо requireAdminEmail — P1 (PLAUSIBLE) · pre-existing, вне монетизации
**Контекст.** `admin/telemetry/route.ts:30` + `telemetryAdmin.ts:12` гейтятся только легаси static-секретом (не requireAdminEmail с email_verified+checkRevoked). Если прод-telemetry-доступ включён — секрет даёт read/update/delete телеметрии без верифицированного email. Поймано code-review (Codex).
**Фикс.** requireAdminEmail первым в каждом telemetry-хендлере; static-disable оставить доп. гейтом.

---

## Deploy S2 code-review (2026-07-14) — ЗАКРЫТО за 7 раундов (in-класс: auth+ownership+metering+cross-ref)

Все находки, что чинились в петле (кросс-провайдер Codex+Claude, до фикспойнта round 7). Пораундовый журнал был в `DEPLOY-PROGRESS.md` (temp, gitignored, удалится на S7). Durable-сводка → [[project_appwide_auth_hardening]]. Итог: tsc 0 · test:fast 3662 · Codex round-7 «DRY».

- **R1 · `studies/analyze` без auth** → FIXED (запись выше).
- **R2 · весь класс unauth AI/mutation-роутов** (~47 файлов) → FIXED: app-wide `getRequiredAuthenticatedUid`(401)+ownership(403)+метринг по `uid`; клиенты шлют `Bearer` (`app/utils/authenticatedRequest.ts`).
- **R3 · `studies/analyze` owner-lockout** (регрессия R1-фикса: `studyId:'new'`/оптимистичный-id блокировал легит-владельца при анализе свежего драфта) → FIXED: `studyId` опционален (анализ гонит body.content, метрится по caller-uid; 403 только на существующий чужой study).
- **R5 · `materials↔notes` cross-user write** (P1×2): POST material c `noteIds=[чужой]` писал materialId в чужую заметку; `deleteNote` каскадил в материалы всех юзеров → FIXED: инвариант «материал ссылается ТОЛЬКО на заметки владельца» (`filterOwnedNoteIds` в create+update), `deleteNote(id, ownerUid)` скоуплен на материалы владельца. +регресс-тесты.
- **R6 · пробелы R5-фикса** → FIXED: removal-путь (`updateMaterial`/`deleteMaterial`) тоже owner-filter (legacy foreign noteId писался через `arrayRemove`); `tags/route.ts` redundant-`userId` 400 убран; `share/notes/[token]` ownerId-ревалидация.
- **P2 · `share-links/route.ts:16` GET mismatch** — игнорит mismatched query `userId` → 200 вместо 403. **НЕ уязвимость** (возвращает СВОИ линки звонящего, не жертвы); оставлен как есть (косметика консистентности), не чинил.

---

## PRE-EXISTING находки из deploy code-review round 6 (2026-07-14) — НЕ регрессии этой работы, отдельные решения

> Ловил Codex-ревьюер в round 6 при исчерпывающем аудите. Разделены от in-класс фиксов (те закрыты). Это pre-existing долг приложения / продуктовые решения — вынести юзеру на приоритизацию, НЕ блокеры монетизации-деплоя.

### ~~БАГ: feedback POST без auth (кнопка спрятана, дверь открыта)~~ — **ИСПРАВЛЕНО (2026-07-14, pre-commit)**
**Был.** `feedback/route.ts` POST не проверял токен (`userId` дефолт `'anonymous'`) → любой слал напрямую (curl мимо UI) → Firestore + SMTP. Кнопка только в `DashboardNav` (приват) → фича и задумана для залогиненных, «анонимен by design» было НЕВЕРНО.
**Фикс.** `getRequiredAuthenticatedUid`(401) + `userId` из токена (не из body); клиент `feedback.service.ts` шлёт `Bearer`. +тест 401. tsc 0 · test:fast зелёный. **Ревью (Codex+Claude) = DRY, новых P0/P1 нет.**
**Остаётся PRE-EXISTING P2 (НЕ введено этим фиксом, не блокеры):** (1) `route.ts:111` HTML-инъекция в письмо владельцу — `feedbackText`/`userEmail` не эскейпятся в HTML-теле (SMTP header-инъекция НЕ подтверждена: Nodemailer 8 санитайзит CR/LF); (2) `route.ts:210` нет валидации картинок (base64 size/MIME) → память/DoS; (3) нет rate-limit → спам БД/SMTP (гость-аноним бесплатен); (4) `route.ts:108` `userEmail` берётся из ТЕЛА запроса (клиент: `useFeedback.ts:27` param `userEmail=''`), НЕ с сервера/токена → сервер доверяет присланному → прямым API-запросом можно поставить Reply-To на чужой email (через UI это твой email/пусто). **Вопрос владельца (2026-07-14): «откуда берётся email?» → ОТВЕТ: из клиентского body, не с сервера.** Разобраться в follow-up. Фикс-направление: эскейп user-полей + **derive email из токена (как сделали с userId)** + validate картинок + rate-limit per uid/IP. **→ follow-up (владелец подтвердил).**

### БАГ: referral Sybil — фейк-аккаунты стакают промо — P1 (PLAUSIBLE) · монетизация-релевантно
**Механика (точно, `referral.server.ts` + `claim/route.ts`).** Награда = **+30 дней tier1 за КАЖДОГО реально зарегавшегося+заклеймившего**, КУМУЛЯТИВНО (прибавляется к текущему сроку, если промо активно и tier1+; `computeReferralPromotion:25-29`). Пример: 20 приглашений, 2 регистрации → инвайтер получает **60 дней (2 мес)**, не 1 и не 20. Считаются регистрации, не отправки.
**Уже защищает:** invitee обязан (а) email_verified, (б) аккаунт <24ч (`NEW_ACCOUNT_WINDOW_MS`), (в) клейм один раз (`referredBy`-sentinel), (г) не self-referral. Sybil стоит: N верифиц. email + N аккаунтов за 24ч.
**РЕШЕНИЕ ВЛАДЕЛЬЦА (2026-07-14) — human-in-the-loop, не авто-блок → фича `FEATURE_CONCEPTS.md` F6:** первые 2 реферала без проверки; на **3-м** → флаг `referralWarning` (в админке) + письмо на `OWNER_EMAIL` «проверь на честность»; промо продолжает копиться; в админке **контрол «отключить промо»** + показ активности юзера (проповеди / last_seen / usage) для ручного суждения «живой vs пустышка». Философия: набрал+пишет = ок · набрал+ничего = подозрение · глупости = warning→блок. **Follow-up после деплоя** (build+ревью-петля).

### БАГ: audio/generate метринг при частичном провале батча — P1 · pre-existing (родня P2 per-batch выше)
**Контекст.** `audio/generate/route.ts:377` — 5 валидных чанков + 1 >4096-символьный через `chunks/route.ts:40` → параллельные провайдер-вызовы, один воркер реджектит, метринг (line 380) не считает ничего.
**РЕШЕНИЕ (2026-07-14, юзер).** Мерить **фактически сгенерированное аудио** (только успешные чанки) — это надёжность УЧЁТА, не расход клиента. Считать по реальному итоговому времени/успешным операциям, а не «раз на батч».

### БАГ: share/notes forged/legacy ownerId — P1 (PLAUSIBLE) → **ЧАСТИЧНО ЗАКРЫТ round 6**
`share/notes/[token]/route.ts` GET теперь ревалидирует `note.userId === shareLink.ownerId` (закрывает форж/legacy-линк на чужую заметку). Остаётся: purge невалидных legacy share-links (data-cleanup, отдельно).

### ~~БАГ: share/notes viewCount инкремент-абуз — P2~~ — **ИГНОРИРУЕМ (2026-07-14, юзер)**
`share/notes/[token]/route.ts:34` — аноним без view-cookie накручивает чужой viewCount. Счётчик-тщеславие, ноль импакта → **не чиним** (осознанное решение).

### ~~БАГ: sermon DELETE — series-cleanup swallow — P2~~ — **ИСПРАВЛЕНО (2026-07-14, pre-commit)**
**Был.** `sermons/[id]/route.ts` — при удалении series-cleanup падал → ошибка глоталась, 200 с висячими series-refs.
**Фикс.** Новый `seriesRepository.deleteSermonAndDetachFromAllSeries(id, ownerUid)` — **один `writeBatch`**: detach owned-серий + delete проповеди вместе или никак (all-or-nothing); чужие серии не трогаются; провал → 500 (не молчаливый 200). +атомик-тест + route-тест на 500. tsc 0 · test:fast зелёный. **Ревью (Codex+Claude) = DRY, новых P0/P1 нет.**
**Остаётся PRE-EXISTING P2:** read (`.get()`) вне batch (batch ≠ транзакция, нет read-isolation) → на конкурентном same-owner edit серии между read и commit возможен lost-update / пропущенная свежая membership → dangling. Тот же паттерн был в старом `removeSermonFromAllSeries`. Фикс исправил cross-doc АТОМАРНОСТЬ (собственно баг), но не read-isolation; истинный фикс = `runTransaction`. Низкая тяжесть (суб-секундное окно).
**INTRODUCED-но-fail-safe (НЕ чиню, объяснено):** writeBatch 500-op кап — sermon в ≥500 owned-серий → batch превысит лимит → 500, ничего не удалено. Под playlist-моделью sermon обычно в ~1 серии (500 = corrupt/невозможно); провал БЕЗОПАСНЫЙ (нет порчи); «фикс» через чанкинг СЛОМАЛ БЫ атомарность (главную цель) → оставлено как есть (инвариант «~1 серия» + fail-safe).

### IN-КЛАСС фиксы round 6 (ЗАКРЫТЫ, регресс-тесты добавлены):
- `studies.repository.ts` — removal-путь (`updateMaterial`/`deleteMaterial`) теперь owner-filter (был пробел round-5-фикса: legacy foreign noteId писался через `arrayRemove`).
- `tags/route.ts` — redundant `userId` → 400 убран (только 403 при mismatch); tagName обязателен.
- `share/notes/[token]` — ownerId-ревалидация (см. выше).

