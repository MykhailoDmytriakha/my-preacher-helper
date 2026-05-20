---
name: live-browser-fix
description: Режим работы для фронтенд-задач — открыть страницу через Claude-in-Chrome MCP, тыкать руками, увидеть проблему, сразу edit код, validate, reload, verify. Не описывать опции, не спрашивать "хочешь починю?" — фиксить на ходу как сеньор-программист со включённым DevTools. Триггеры — ЛЮБОЙ из сигналов: фронтенд/UX задача с нетривиальным потоком; "проверь как работает", "посмотри страницу", "потести"; "ничего не изменилось" / "не работает" от пользователя; "сразу фикси", "ты как сеньор программист", "если видишь ошибки сразу фикси", "если ввидишь проблемы с дизайном или что флоу непонятен тоже сразу фикси"; завершение implementation волны где нужен Phase 5 Validate; разработка фичи где код "выглядит правильно" но реального UX нет; bug которые НЕ ловятся unit-тестами (focus management, event ordering, race conditions между state updates, draftText flush). Активируй автоматически без явной просьбы когда задача затрагивает любой visible component. Не использовать для: чистого backend, refactor без UI surface, типографики/CSS без logic.
---

# Live browser fix mode

Способ работать так, будто у тебя открыт DevTools и пользователь смотрит через плечо. Минимум "опишу что должно быть" — максимум "увидел, починил, повторил".

Это **production-grade smoke** во время разработки, не финальный QA. Каждый цикл — observe → fix → verify занимает 30-90 секунд. Замещает 2-3 круга "пользователь сказал не работает → я починил".

## 1. Суть режима

**Unit-тесты ловят логику. Browser ловит реальность.** На node-based notes волне (2026-05-20) этот режим в одной сессии закрыл 6 багов которые НЕ ловились никакими тестами:

- **Textarea не получает фокус** на edit mode entry — Codex's `handleStartEmptyTree` ставил focus на container, не на textarea, type events съедались. Тест pass'ил потому что тест проверял dispatch, не focused element.
- **Esc стопил edit без flush draftText** — textarea unmount без onBlur, локальный state draftText терялся. Reducer тест не видел потому что dispatch шёл правильный, но между type'ом и stopEdit нечего не сохранялось.
- **splitFromMarkdown не идемпотентен** — useEffect flushил `draftTextRef.current` с оригинальным markdown ПОСЛЕ split, reducer запускал split повторно → дубликаты children. Reducer тест на single dispatch проходил, real flow с двумя последовательными dispatches — нет.
- **Default editor не node-tree** — на `/studies/new` рендерился legacy RichMarkdownEditor вместо нового, потому что `useNodeEditor = Boolean(rootNode) || nodeEditorOptIn` — без `isNew` в условии. Пользователь увидел "ничего не изменилось" — это **honest signal** что код-mental-модель разошлась с реальностью.
- **Title click coord mismatch** — `useState(isNew)` для isEditing, после "Готово" toggle title рендерился как `<h1>` (read mode), click шёл в пустоту. Расшифровывалось только когда полез в DOM через `javascript_tool`.
- **Wikilinks отсутствовали как UI affordance** — MarkdownDisplay не поддерживал `[[id]]` синтаксис, пользователь сказал "должны быть ссылки на другие ноты" — этого нельзя было увидеть из тестов.

Каждый из этих багов будет в production ловиться юзером, а не CI. Live browser fix = поймать их до того как ушло.

## 2. Когда активировать (автоматически)

- Любая задача с visible UI компонентом — после implementation **всегда** прогнать через browser перед declared "готово".
- Фраза от юзера: "проверь как работает", "потести", "посмотри страницу", "ничего не изменилось", "не работает", "ты как сеньор", "сразу фикси", "если видишь проблемы — фикси".
- После delegating Codex'у — пока Codex пишет, **сам** в browser живёшь, ловишь UX gaps от своих/Codex's предыдущих изменений.
- Phase 5 (Validate) волны 7-cycle — обязательная часть, не optional.
- Когда unit-тесты pass но "что-то не так" feeling — это сигнал что ловится только в browser.

## 3. Pipeline (sequential, minimum round-trips)

### Setup (один раз за сессию)

1. Убедиться dev server up: `lsof -ti:3000` или `npm run dev` в background.
2. `mcp__claude-in-chrome__tabs_context_mcp` с `createIfEmpty=true` — получить tabId.
3. Запомнить tabId для последующих `browser_batch`.

### Цикл observe → fix → verify

Каждый цикл = ОДИН `browser_batch` с минимум 3 actions:

```js
browser_batch([
  navigate(url),                          // или back/forward
  computer.wait(2-4 sec для compile),
  computer.screenshot(save_to_disk: true) // увидеть состояние
])
```

Когда screenshot показал проблему:

```js
// 1. Read code that you suspect
Read(file, offset, limit)
// 2. Edit immediate fix (no "let me think about options")
Edit(file, old, new)
// 3. Validate в isolation
Bash("npx tsc --noEmit && npx jest --testPathPattern=...")
// 4. Reload + re-screenshot — same browser_batch
browser_batch([
  navigate(url),  // re-navigate triggers reload
  computer.wait(3-4),
  computer.screenshot
])
```

**Никогда** не описывать "вижу проблему X, могу починить если хочешь" — сразу Edit. User дал carte blanche фразой "сразу фикси".

### Интеракция через MCP

- **Click через ref** надёжнее координат: `read_page` → берёшь `ref_NN` → `computer.left_click({ref: "ref_NN"})`. Не угадывать pixel coordinates.
- **Type** — после focused element. Если type не попадает, значит focus не там — проверь через `javascript_tool` что `document.activeElement` это нужный textarea.
- **Screenshot save_to_disk: true** только когда хочешь дать user proof — иначе скриншот висит в output без файла.
- **get_page_text** + **read_page filter:interactive** — два разных взгляда. Текст показывает фактическое содержимое (находит дубликаты!), interactive показывает refs для clicks.
- **javascript_tool** когда DOM/state нужно проверить точно — `document.querySelectorAll`, `getBoundingClientRect`, активный element, computed styles. Незаменим когда координаты "должны работать" но не работают.

### Не ждать

- Background bash для одних-occurrence wait (Codex finished, dev server ready, file appears): `until [ -f X ]; do sleep 30; done` с `run_in_background: true` — будет notification.
- НЕ polling-loop sleep — он blocking. Если ждёшь что-то external, всегда run_in_background.
- Параллельная работа во время ожидания — другие independent rails задачи (Stage 5 admin route пока Codex Stage 3, Stage 4 prep пока финальный smoke).

## 4. Что и в каком порядке чинить

Priority (immediate, не collecting):

1. **Data loss / silent breakage** — text потерялся при save, дубликат в Firestore, race condition. Чинить **первым** даже посреди другой задачи.
2. **UX dead-end** — пользователь не может сделать что нужно (no Done button, no add-child UI, нельзя добавить media). Add visible affordance.
3. **Confusion** — UI работает но flow непонятен (focus прыгает, что нажать не очевидно). Refactor взаимодействия.
4. **Polish** — animations, spacing, copy. Только в конце волны или когда специально fokусируешься на polish.

Не «оставлю на потом» если можно починить сейчас за 2 минуты. Если требует архитектурного решения — записать как forward-flag (Stage N+1) и продолжить.

## 5. Anti-patterns

- **"Сейчас я опишу что вижу"** перед fix — описание без действия. User видит описание, хочет результат.
- **Угадывание pixel coordinates** для click когда есть ref. Read_page → ref → клик. На разных viewport coords меняются, ref устойчив.
- **"Это работает, тесты прошли"** без browser verify. Тесты не покрывают focus, event order, async flush race, browser-specific behaviour.
- **Ждать tests/Codex молча**. Параллельно делать independent rails или browser smoke других кейсов.
- **Patch той же ошибки во второй раз** — если "очевидный фикс" не помог 2 раза, проблема не в layer где патчу. Использовать `javascript_tool` для DOM-state, `read_console_messages` для логов, `dig-deeper` skill для root cause.
- **Скрывать стейт от user** во время debug — если bug нашёл, скажи 1 предложением "найден X, чиню". Не молчать.

## 6. Real example (этот же проект, 2026-05-20)

User: "посмотри" + screenshot с legacy editor вместо node-tree.

1. Открыл `/studies/new` через MCP → увидел RichMarkdownEditor toolbar (B/I/H1-H3), не node placeholder.
2. **Не описал** "ага, default не переключён" — прямо Edit'нул `useNodeEditor = isNew || ...` в page.tsx.
3. TSC clean + jest pass → reload через `navigate(/studies/new)` → screenshot.
4. Увидел "Click here to start" — переключение сработало.
5. Click placeholder → type "Первая мысль" → textarea пустая. **Сразу** investigate: focus issue. Edit NodeView добавив useEffect для focus textarea при isEditing && isFocused.
6. Re-test → type попадает в textarea.
7. Esc → text потерялся. Edit NodeView добавив useEffect для flush draft на exit edit.
8. Re-test → text persistedи отображается в read mode.
9. Создал большой markdown заметку → Esc → видел duplicated content × 3 в read mode. Investigate reducer + flush ordering → splitFromMarkdown не идемпотентен. Refactor action с text payload, atomic. Re-test.

Каждый цикл ~ 60-90 секунд. Шесть багов закрыто за ~10 минут. Без живого browser весь этот раунд пришёл бы как 6 раундов user feedback'а через дни.

## 7. Связанные скиллы

- `codex` — параллельный исполнитель для focused multi-file scope. Спавнить **до** browser smoke если ясный delegated scope, продолжать smoke в browser пока Codex работает.
- `dig-deeper` — когда "очевидный фикс" не работает 2-3 раза, switching к investigative mode.
- `wave-flow-7-cycle` — Phase 5 (Validate) теперь по умолчанию через этот режим, не только unit-тесты.
- `verify` — built-in skill для running app verification, но live-browser-fix включает fix loop, не только observe.

## 8. Quick checklist при начале фронтенд-задачи

- [ ] Dev server up?
- [ ] MCP tab created?
- [ ] После любого Edit — reload + screenshot
- [ ] После любого user "проверь" — открыть в browser сам, не отвечать только из кода
- [ ] Все найденные bugs пофикшены до того как report "готово"
