# Refactoring Prompts — sermons/[id]

Контекстные файлы:
- `/Users/mykhailo/MyProjects/my-preacher-helper/frontend/app/(pages)/(private)/sermons/[id]/page.tsx`
- `/Users/mykhailo/MyProjects/my-preacher-helper/frontend/app/(pages)/(private)/sermons/[id]/plan/page.tsx`
- `/Users/mykhailo/MyProjects/my-preacher-helper/frontend/app/(pages)/(private)/sermons/[id]/structure/page.tsx`

## Prompt 1 — Remove Dead Block

Ты — Codex. Твоя зона: рефакторинг кода + автопроверки. Claude Code/Antigravity делает manual QA.

Задача: удалить мертвый блок `false && (...)` в sermons/[id]/page.tsx без изменения поведения.

Сделай:
1) Удали весь блок `false && (...)`.
2) Удали связанные неиспользуемые импорты/переменные.
3) Не меняй внешний UX и маршруты.

Автопроверки:
1) TypeScript check.
2) Тесты страницы sermons/[id] (mode transitions + detail tests).

Manual QA (Claude/Antigravity):
1) Открыть `/sermons/{id}` и `/sermons/{id}?mode=prep`.
2) Проверить переключение режимов.
3) Проверить, что запись аудио, фильтры, структура и модалки работают как до рефактора.
4) Проверить отсутствие визуальных регрессий на mobile/desktop.

## Prompt 2 — Deduplicate prep save pattern

Ты — Codex. Твоя зона: код + автопроверки. Claude/Antigravity: manual QA.

Задача: убрать дубли `setPrepDraft(next); await savePreparation(next);` в sermons/[id]/page.tsx через единый helper.

Сделай:
1) Введи helper (например, `applyPrepUpdate`) для атомарного update+persist.
2) Перепиши все обработчики prep-шагов на helper.
3) Поведение и payload запросов не менять.

Автопроверки:
1) TypeScript check.
2) Тесты prep flow (если есть) + tests страницы sermons/[id].

Manual QA:
1) В каждом шаге prep изменить по 1 полю и сохранить.
2) Перезагрузить страницу, убедиться что значения сохранены.
3) Проверить отсутствие двойных сохранений/ошибок в UI.

## Prompt 3 — Config-driven prep steps

Ты — Codex. Твоя зона: код. Claude/Antigravity: ручная валидация.

Задача: refactor renderPrepContent в конфиг-ориентированную схему (step config), без изменения текущей логики.

Сделай:
1) Создай массив конфигурации шагов (id, title, done, renderer).
2) Убери ручное дублирование 7 PrepStepCard-блоков.
3) Сохрани текущий порядок, активный шаг, toggle-поведение.

Автопроверки:
1) TypeScript check.
2) Тесты mode transitions/sermon detail.

Manual QA:
1) Проверить шаги 1..7 по порядку.
2) Проверить auto-active шаг.
3) Проверить ручной expand/collapse.
4) Проверить `prepStep` query param автоскролл.

## Prompt 4 — Extract classic thoughts UI

Ты — Codex. Твоя зона: рефакторинг. Claude/Antigravity: manual testing.

Задача: выделить блок classic thoughts UI в отдельный компонент (или пару компонентов) из sermons/[id]/page.tsx.

Сделай:
1) Вынеси фильтры, active-filters, brainstorm, thought list в отдельный компонент.
2) Сохрани текущие props-контракты и события.
3) Убери дублирующий JSX, не меняя UX.

Автопроверки:
1) TypeScript check.
2) Тесты фильтрации/sermon page layout.

Manual QA:
1) Открытие/закрытие filter dropdown.
2) Комбинации фильтров (view/structure/tag/sort).
3) Brainstorm open/close.
4) Редактирование/удаление мысли из списка.

## Prompt 5 — Extract recorder portal bridge

Ты — Codex. Зона: код. Claude/Antigravity: ручная проверка.

Задача: выделить логику портала AudioRecorder в отдельный компонент-bridge в sermons/[id]/page.tsx.

Сделай:
1) Вынеси повторяемый JSX recorder (включая splitLeft кнопку).
2) Сохрани поведение портала для prep/classic режимов.
3) Сохрани readOnly/disabled логику.

Автопроверки:
1) TypeScript check.
2) Тесты mobile structure placement + mode transitions.

Manual QA:
1) Проверить отображение recorder в обоих режимах.
2) Проверить добавление manual thought.
3) Проверить retry transcription flow.
4) Проверить disabled состояние в readOnly/offline.

## Prompt 6 — Shared section resolver util

Ты — Codex. Твоя зона: код + локальные автопроверки. Claude/Antigravity: manual QA.

Задача: создать общий util для определения section по `outlinePointId` и использовать его в plan/page.tsx и sermons/[id]/page.tsx (и где уместно).

Сделай:
1) Вынеси поиск section (`introduction|main|conclusion`) в общий util.
2) Замени дубли `outline.introduction.some(...)` и аналогичные блоки.
3) Не меняй бизнес-логику.

Автопроверки:
1) TypeScript check.
2) Тесты sermonPlan + sermonDetail.

Manual QA:
1) Генерация контента для outline point в каждой секции.
2) Сохранение point content.
3) Переходы plan ↔ structure.

## Prompt 7 — Deduplicate insertAtOutlineGroupEnd

Ты — Codex. Зона ответственности: код. Claude/Antigravity: manual validation.

Задача: убрать дубли `insertAtOutlineGroupEnd` в structure/page.tsx и вынести в util/локальную функцию.

Сделай:
1) Оставь одну реализацию insertAtOutlineGroupEnd.
2) Используй её и для UI state update, и для persistence branch.
3) Не меняй порядок вставки thoughts.

Автопроверки:
1) TypeScript check.
2) Тесты structure page handlers/integration.

Manual QA:
1) Добавить audio thought в intro/main/conclusion.
2) Проверить позицию вставки в рамках outlinePoint group.
3) Проверить, что structure сохраняется и не ломается drag-n-drop.

## Prompt 8 — Extract plan height sync hook

Ты — Codex. Твоя зона: код + smoke tests. Claude/Antigravity: ручной QA.

Задача: вынести из plan/page.tsx логику синхронизации высот карточек в custom hook (например, `usePlanHeightSync`).

Сделай:
1) Перенеси syncHeights/syncPairHeights/debounce/resize effects в hook.
2) Сохрани поведение только для `lg` и reset на mobile.
3) Не ломай edit/generate сценарии.

Автопроверки:
1) TypeScript check.
2) Тесты sermonPlan (container width/resize listener).

Manual QA:
1) Открыть plan, сгенерировать контент разной длины.
2) Проверить выравнивание пар карточек на desktop.
3) Проверить отсутствие “высоких” карточек на mobile.
4) Проверить поведение после resize.

## Prompt 9 — Extract copy/export logic

Ты — Codex. Твоя зона: рефакторинг + автопроверки. Claude/Antigravity: manual тесты.

Задача: вынести copy/export логику из plan/page.tsx в отдельный hook/service (copy formatted + plain + markdown/pdf assembly).

Сделай:
1) Вынеси `copyFormattedFromElement` и export builders.
2) Сохрани текущие статусы кнопок копирования (idle/copying/success/error).
3) Сохрани существующий output формат.

Автопроверки:
1) TypeScript check.
2) Тесты sermonPlan + e2e preaching timer workflow (если в проекте есть).

Manual QA:
1) Проверить copy в overlay режиме.
2) Проверить copy в immersive режиме.
3) Проверить export plain/markdown/pdf.
4) Проверить, что текст включает title/verse/3 секции.

## Prompt 10 — Final modular refactor pass

Ты — Codex. На тебе код и автоматическая проверка. Claude/Antigravity делает manual regression pass.

Задача: финальный модульный refactor `sermons/[id]` без изменения поведения: разнести крупные page-файлы на feature-компоненты/хуки и уменьшить общий LOC.

Сделай:
1) Декомпозируй большие функции в локальные feature modules.
2) Сохрани публичные маршруты, состояние, side-effects.
3) Обнови/добавь точечные тесты только где реально изменились контракты.
4) Подготовь changelog: что вынесено, что не трогали, риски.

Автопроверки:
1) TypeScript check.
2) Набор тестов: sermon detail, sermon plan, structure handlers/integration, mode transitions.

Manual QA:
1) Полный smoke по `/sermons/{id}`, `/sermons/{id}/plan`, `/sermons/{id}/structure`.
2) Проверить prep/classic, filter/sort, audio/manual thought, edit/delete thought.
3) Проверить plan overlay/immersive/preaching timer.
4) Проверить structure DnD, ambiguous section, reviewed toggle, outline point add/delete.

---

## Reporting Protocol (обязательно после каждого выполненного пункта)

После каждого выполненного prompt-пункта Codex добавляет запись в `Execution Report Log` с фактами:
1) Что сделано (кратко и по делу).
2) Какие файлы изменены.
3) Какие проверки запущены и их результат.
4) Что нужно вручную проверить Claude Code / Antigravity.
5) Риски/заметки для следующего проверяющего.

Шаблон записи:

```md
### [YYYY-MM-DD] Prompt N — <название>
Status: done | partial | blocked

Code changes:
- <файл>: <что изменено>

Auto checks:
- <команда> -> PASS/FAIL

Manual QA handoff (Claude/Antigravity):
1) ...
2) ...

Notes/Risks:
- ...
```

## Execution Report Log

### [2026-02-27] Prompt 1 — Remove Dead Block
Status: done

Code changes:
- `/Users/mykhailo/MyProjects/my-preacher-helper/frontend/app/(pages)/(private)/sermons/[id]/page.tsx`: удален мертвый блок `false && (...)` (legacy альтернативный layout, который никогда не исполнялся).
- `/Users/mykhailo/MyProjects/my-preacher-helper/frontend/app/(pages)/(private)/sermons/[id]/page.tsx`: удалены неиспользуемые импорты `MotionConfig` и `PreachDateList` после удаления мертвого блока.
- Фактический дифф по файлу: ~500 удалений, поведение runtime не менялось.

Auto checks:
- `npx tsc --noEmit` -> PASS
- `npm run test:fast -- __tests__/pages/sermons/SermonPage.modeTransitions.test.tsx __tests__/pages/sermonDetail.test.tsx` -> PASS (2 suites, 30 tests)

Manual QA handoff (Claude/Antigravity):
1) Открыть `/sermons/{id}` и `/sermons/{id}?mode=prep`.
2) Проверить переключение режимов.
3) Проверить аудиозапись, фильтры, структуру и модалки.
4) Проверить mobile/desktop на визуальные регрессии.

Notes/Risks:
- Изменение было только удалением недостижимого кода; риск функциональной регрессии низкий.

### [2026-02-27] Prompt 2 — Deduplicate prep save pattern
Status: done

Code changes:
- `/Users/mykhailo/MyProjects/my-preacher-helper/frontend/app/(pages)/(private)/sermons/[id]/page.tsx`: добавлен helper `applyPrepDraftUpdate(next)` для единой атомарной операции `setPrepDraft + savePreparation`.
- `/Users/mykhailo/MyProjects/my-preacher-helper/frontend/app/(pages)/(private)/sermons/[id]/page.tsx`: в prep callbacks заменены повторяющиеся пары `setPrepDraft(next); await savePreparation(next);` на `await applyPrepDraftUpdate(next);`.
- Результат: удалено дублирование в 22 местах активного кода prep flow, payload и порядок сохранения не изменены.

Auto checks:
- `npx tsc --noEmit` -> PASS
- `npm run test:fast -- __tests__/pages/sermons/SermonPage.modeTransitions.test.tsx __tests__/pages/sermonDetail.test.tsx` -> PASS (2 suites, 30 tests)

Manual QA handoff (Claude/Antigravity):
1) Пройти все шаги prep (1..7), изменить по одному полю, сохранить -> OK
2) Перезагрузить страницу и убедиться, что значения сохранены -> OK (Проверено с префиксом "Test ...")
3) Проверить, что не появилось двойных сохранений/ошибок в UI -> OK
4) Проверить переключение classic/prep после сохранений -> OK

Notes/Risks:
- Логика централизована в одном helper; это снижает риск расхождения поведения между шагами.

### [2026-02-27] Prompt 3 — Config-driven prep steps
Status: done

Code changes:
- `/Users/mykhailo/MyProjects/my-preacher-helper/frontend/app/(pages)/(private)/sermons/[id]/page.tsx`: добавлены `PrepStepId` и `PREP_STEP_IDS` для единых идентификаторов prep-этапов.
- `/Users/mykhailo/MyProjects/my-preacher-helper/frontend/app/(pages)/(private)/sermons/[id]/page.tsx`: `manuallyExpanded` типизирован как `Set<PrepStepId>`.
- `/Users/mykhailo/MyProjects/my-preacher-helper/frontend/app/(pages)/(private)/sermons/[id]/page.tsx`: `renderPrepContent` переведен на конфиг-ориентированный рендер (`prepStepConfigs` + `prepStepContentById` + `map`) вместо 7 вручную продублированных `PrepStepCard` блоков.
- `/Users/mykhailo/MyProjects/my-preacher-helper/frontend/app/(pages)/(private)/sermons/[id]/page.tsx`: `activeStepId`, `isStepExpanded`, `toggleStep`, и обработка `prepStep` query-param синхронизированы с `PrepStepId`/`PREP_STEP_IDS`.

Auto checks:
- `npx tsc --noEmit` -> PASS
- `npm run test:fast -- __tests__/pages/sermons/SermonPage.modeTransitions.test.tsx __tests__/pages/sermonDetail.test.tsx` -> PASS (2 suites, 30 tests)

Manual QA handoff (Claude/Antigravity):
1) Проверить шаги 1..7 в правильном порядке -> OK
2) Проверить auto-active step (по степени заполнения prep) -> OK
3) Проверить ручной expand/collapse неактивных шагов -> OK
4) Проверить `?prepStep=<id>` автоскролл и раскрытие целевого шага -> OK (Проверено для `homileticPlan`)
5) Проверить сохранение полей в каждом шаге и восстановление после reload -> OK

Notes/Risks:
- Контейнеры шагов теперь строятся из конфига; риск регрессии низкий, но важна ручная проверка порядка и поведения раскрытия шагов.

### [2026-02-27] Prompt 4 — Extract classic thoughts UI
Status: done

Code changes:
- `/Users/mykhailo/MyProjects/my-preacher-helper/frontend/app/components/sermon/ClassicThoughtsPanel.tsx`: добавлен новый компонент `ClassicThoughtsPanel` (включая `StructureFilterBadge` и `ActiveFilters`), который инкапсулирует classic thoughts UI: filter dropdown, brainstorm trigger/panel и `ThoughtList`.
- `/Users/mykhailo/MyProjects/my-preacher-helper/frontend/app/(pages)/(private)/sermons/[id]/page.tsx`: удалены локальные `StructureFilterBadge` и `ActiveFilters`.
- `/Users/mykhailo/MyProjects/my-preacher-helper/frontend/app/(pages)/(private)/sermons/[id]/page.tsx`: `renderClassicContent` заменен на thin-wrapper над `<ClassicThoughtsPanel ... />` с сохранением существующих state/handlers/props-контрактов.
- `/Users/mykhailo/MyProjects/my-preacher-helper/frontend/app/(pages)/(private)/sermons/[id]/page.tsx`: очищены импорты, которые стали не нужны после выноса JSX-блока.

Auto checks:
- `npx tsc --noEmit` -> PASS
- `npm run test:fast -- __tests__/pages/sermons/SermonPage.modeTransitions.test.tsx __tests__/pages/sermonDetail.test.tsx` -> PASS (2 suites, 30 tests)

Manual QA handoff (Claude/Antigravity):
1) Открыть/закрыть filter dropdown на `/sermons/{id}` и убедиться в корректной работе outside-click -> OK
2) Протестировать комбинации фильтров `view/structure/tag/sort`, включая reset -> OK
3) Проверить brainstorm open/close и сохранение поведения в classic/prep split -> OK
4) Проверить edit/delete thought из списка и отсутствие UI-регрессий на mobile/desktop -> FIXED (см. hotfix ниже)

Notes/Risks:
- `ClassicThoughtsPanel` использует `sermonId!` внутри brainstorm panel (как и раньше логика полагается на наличие `sermon` при рендере контента); runtime-риск низкий при текущем guard `if (!sermon) return ...`.

### [2026-02-27] Prompt 4 Hotfix — Double confirmation on thought delete
Status: done

Bug: После удаления мысли сначала показывался `ConfirmModal` (новый), а после его подтверждения — системный `window.confirm()` (старый, оставшийся в `handleDeleteThought` в `page.tsx`). Диалоги срабатывали последовательно.

Root cause: `handleDeleteThought` в `page.tsx` содержал `window.confirm()` и `alert()` — они не были убраны при добавлении `ConfirmModal` в `ThoughtCard`.

Code changes:
- `frontend/app/components/ThoughtCard.tsx`: добавлен `ConfirmModal` + state `deleteConfirmOpen`; `onDelete` в `ThoughtOptionsMenu` теперь открывает модал вместо прямого вызова prop.
- `frontend/app/(pages)/(private)/sermons/[id]/page.tsx`: удалены `window.confirm()` и `alert()` из `handleDeleteThought` — подтверждение полностью перенесено в `ThoughtCard`.

Notes/Risks:
- `ConfirmModal` переиспользует существующий ключ `sermon.deleteThoughtConfirm` (все 3 локали).
- Текст мысли в описании обрезается до 100 символов.
