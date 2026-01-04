# Project Memory (Project Operating Manual)

> **Принцип:** Memory — это не хранилище, а pipeline обучения.
> **Flow:** Lessons (сырые) → Short-Term (осмысление) → Long-Term (инструкции)

---

## 🆕 Lessons (Inbox) — Только что выучено

> Сырые записи о проблемах и решениях. Записывать СРАЗУ после подтверждения пользователя.

### 2026-01-04 Badge alignment in wrapped outline titles
**Problem:** In the Focus sidebar outline list, count badges looked mis-centered when titles wrapped to multiple lines.
**Attempts:** Centered the digits inside the badge with `inline-flex` + fixed height.
**Solution:** Move the badge out of the inline text flow into a sibling flex item so it aligns to the full text block, not the last line baseline.
**Why it worked:** Inline badges align to the last line’s baseline in multi-line text, which makes them appear off-center; flex siblings align to the block’s center.
**Principle:** For multi-line text with trailing badges, render the badge as a sibling in a flex row rather than inline text.

### 2026-01-04 Coverage requires changed-line verification
**Problem:** Tests passed, but it was unclear whether the new UI changes were actually exercised.
**Attempts:** Relying on overall coverage numbers and green test status.
**Solution:** Add targeted tests that assert the specific new DOM structure/classes introduced by the change and verify those lines are covered.
**Why it worked:** Green tests can miss changed logic; explicit assertions map test execution to the modified lines.
**Principle:** Treat “tests green” as insufficient—always validate that the changed lines are executed and asserted.

### 2026-01-04 Focus sidebar refactor boundaries
**Problem:** Фокус‑режим в `Column.tsx` был монолитным, требовалось вынести sidebar, не ломая UI и тесты.
**Attempts:** Сначала вынес структуру в layout/sidebar компоненты и увидел, что пропал блок Unassigned Thoughts в focus‑content.
**Solution:** Вынес focus‑layout в `FocusModeLayout` и `FocusSidebar` со слотами (header/actions/points), сохранил классы (`bg-gray-50`, `dark:bg-gray-800`, `lg:w-72`) и вернул Unassigned Thoughts в focus‑content.
**Why it worked:** Слотовая композиция сохранила DOM‑структуру и CSS‑классы, а восстановление Unassigned‑блока вернуло ожидаемое поведение и тесты.
**Principle:** При рефакторинге UI‑контейнеров сохраняй ключевые классы/DOM и проверяй логические секции (например, Unassigned) в обоих режимах.
---

## 🔄 Short-Term Memory (Processing) — На осмыслении

> Lessons которые нужно обработать. Группировать похожие, извлекать принципы.


---

## 💎 Long-Term Memory (Operating Protocols) — Интернализированные правила

> Инструкции по взаимодействию с проектом. Формат: "Контекст → Протокол → Причина"

### 🔧 Code Quality & Linting Protocols

**String Duplication Management**
*   **Context:** Проект использует SonarJS правила.
*   **Protocol:** При появлении 3+ одинаковых строк — **ОБЯЗАТЕЛЬНО** выносить в константу в начале файла.
*   **Reasoning:** Предотвращает ошибки копипасты и усложнение поддержки (`sonarjs/no-duplicate-string`).

**Cognitive Complexity Control**
*   **Context:** React компоненты и бизнес-логика.
*   **Protocol:** Если Cognitive Complexity > 20 (или warning):
    *   JSX: Выносить условные блоки в отдельные компоненты/рендер-хелперы.
    *   Logic: Использовать map/object lookups вместо вложенных тернарников.
*   **Reasoning:** Поддерживаемость кода. В React условный рендеринг в основном теле компонента сильно увеличивает сложность.

**Component Prop Cleanup**
*   **Context:** Удаление неиспользуемых пропсов.
*   **Protocol:** Действовать каскадно: Interface → Destructuring → Usage (grep) → Tests.
*   **Reasoning:** Оставленные "висячие" пропсы создают путаницу в API компонента.

**ESLint-Induced Test Failures**
*   **Context:** Автоматические фиксы линтера.
*   **Protocol:** После применения ESLint fixes — **НЕМЕДЛЕННО** запускать тесты.
*   **Reasoning:** Авто-фиксы могут ломать логику (например, перемещение хуков или изменение порядка импортов).

### 🧪 Testing Protocols

**Jest Mocking Architecture**
*   **Context:** Module loading phase в Jest.
*   **Protocol:** В `jest.mock()` использовать **ТОЛЬКО** строковые литералы. Переменные объявлять внутри фабрики или использовать `doMock`.
*   **Reasoning:** Переменные вне мока не инициализированы в момент поднятия мока (`ReferenceError`).

**Browser API Simulation**
*   **Context:** JSDOM окружение.
*   **Protocol:** Для API, отсутствующих в JSDOM (`matchMedia`, `ResizeObserver`, `clipboard`):
    *   Создавать полные моки с методами-заглушками.
    *   Тестировать fallback-сценарии (если API недоступно).
*   **Reasoning:** Компоненты падают при рендеринге без этих API.

**Framework Constraints Priority**
*   **Context:** Конфликт "Чистый код" vs "Требования тестов".
*   **Protocol:** Если требования Jest/RTL конфликтуют с красотой кода (например, дублирование моков) — **ВЫБИРАТЬ ТРЕБОВАНИЯ ТЕСТОВ**.
*   **Reasoning:** Работающие тесты важнее эстетики в тестовой инфраструктуре.

**Agent-Created Tests Must Run**
*   **Context:** Я добавляю новые тесты.
*   **Protocol:** Всегда запускать созданные мной тесты до ответа пользователю; добиваться green.
*   **Reasoning:** Пользователь ожидает подтвержденный результат и зеленый тестовый статус.

**Translation Mocking**
*   **Context:** `react-i18next` тесты.
*   **Protocol:** Мокать `t` функцию так, чтобы она возвращала ключ или интерполировала параметры, если они переданы.
*   **Reasoning:** Тесты часто проверяют наличие конкретного текста, который зависит от переданных переменных.

### 🔄 React & State Management Protocols

**useEffect Safety**
*   **Context:** Dependency arrays.
*   **Protocol:** **НИКОГДА** не использовать вычисляемые объекты/массивы в deps. Конвертировать ID массивов в строки (`ids.join(',')`) или использовать `useMemo`.
*   **Reasoning:** Бесконечные циклы ре-рендеринга из-за нестабильных ссылок.

**State Transition Integrity**
*   **Context:** Отслеживание изменений стейта (например, открытие таймера).
*   **Protocol:** Использовать `useRef` для хранения предыдущего значения и сравнивать с текущим внутри эффекта.
*   **Reasoning:** Эффекты запускаются чаще, чем кажется. Ref гарантирует реакцию только на *изменение*.

**Hook Import Verification**
*   **Context:** Добавление `useMemo`/`useCallback`.
*   **Protocol:** После добавления хука — **ЯВНО** проверить секцию импортов.
*   **Reasoning:** Runtime crash (`React.useMemo is not a function`) — частая ошибка при рефакторинге.

### 🎨 UI/UX Design System Standards

**Modal Auto-Grow with Scoped Scroll**
*   **Context:** Модальные формы, где textarea должна расти до лимита и скроллиться только она.
*   **Protocol:** Делать фиксированные header/meta/footer + textarea; считать max-height textarea как `90vh - header - meta - footer - padding`; авто-растягивать textarea до лимита; включать scroll **только** внутри textarea после достижения лимита.
*   **Reasoning:** Убирает вложенные скроллы и предотвращает UI скачки, сохраняя ожидаемый UX (скроллится только целевой блок).

**Multi-line Truncation**
*   **Context:** Текст в списках/карточках (особенно с иконками).
*   **Protocol:** Использовать: `line-clamp-X` + `break-words` + `flex-1` (или `min-w-0`). **ИЗБЕГАТЬ** `truncate` (только для 1 строки).
*   **Reasoning:** `truncate` ломает верстку если текст длиннее одной строки, скрывая важный контекст.

**Stable DOM Structure**
*   **Context:** Conditional rendering (Empty vs Loaded states).
*   **Protocol:** Поддерживать одинаковый корневой тег (обычно `div`) и структуру оберток для обоих состояний.
*   **Reasoning:** Предотвращает Layout Shifts и упрощает CSS селекторы/тесты.

**Input Interaction Consistency**
*   **Context:** Интерактивные элементы (теги, ссылки).
*   **Protocol:** Любой кликабельный инпут должен поддерживать: Click + Keyboard (Enter).
*   **Reasoning:** Accessibility (a11y) requirement.

**Card Actions Hierarchy**
*   **Context:** Длинные списки или контент.
*   **Protocol:** Кнопки действий (Edit/Delete) размещать в **Header**, а не внизу.
*   **Reasoning:** Пользователь не должен скроллить 10к слов чтобы найти кнопку редактирования.

### 📆 Calendar Module Protocols

**View vs Selection Separation**
*   **Context:** Навигация календаря.
*   **Protocol:** Разделять `viewedMonth` (что видим) и `selectedDate` (что выбрали). Передавать `viewedMonth` в дочерние списки.
*   **Reasoning:** Пользователь может смотреть события января, выбрав дату в декабре. Списки должны показывать январь.

**Series Integration Consistency**
*   **Context:** Вторичные представления (Календарь, Агенда).
*   **Protocol:** Наследовать визуальные паттерны (цвета серий, бейджи) из Dashboard. Использовать `useSeries`.
*   **Reasoning:** Пользователь должен узнавать серию проповеди мгновенно, вне зависимости от экрана.

### 🌍 Localization (i18n) Protocols

**Native Pluralization Rule**
*   **Context:** Next.js + i18next engine.
*   **Protocol:** Использовать суффиксы `_one`, `_few`, `_many`, `_other`. **ЗАПРЕЩЕНО** использовать ICU синтаксис `{{count, plural...}}` внутри строки.
*   **Reasoning:** ICU формат часто вызывает ошибки парсинга/гидратации в текущем стеке.

**Transactional Updates**
*   **Context:** Добавление/изменение ключей.
*   **Protocol:** `grep` ключа → Обновление **ВСЕХ ТРЕХ** файлов (`en`, `ru`, `uk`) в одном коммите.
*   **Reasoning:** CI тесты покрытия переводов упадут, если пропустить язык.

### 🧭 Architecture & Navigation Protocols

**Next.js 15 Async Params**
*   **Context:** Динамические роуты.
*   **Protocol:** Всегда `await params` перед использованием. Тип: `Promise<{ id: string }>`.
*   **Reasoning:** Требование Next.js 15. Синхронный доступ вызывает ворнинги/ошибки.

### 🤖 AI Integration Protocols

**Structured Output Enforcement**
*   **Context:** Генерация данных (мысли, теги).
*   **Protocol:** Использовать только `zodResponseFormat` + `beta.chat.completions.parse()`.
*   **Reasoning:** Regex/JSON parsing из текста ненадежны. Zod гарантирует схему.

**Scripture Reference Handling**
*   **Context:** Парсинг библейских ссылок.
*   **Protocol:** Запрашивать названия книг **НА АНГЛИЙСКОМ** в промптах.
*   **Reasoning:** Наш `referenceParser.ts` работает с английскими названиями для унификации.

---

## 🔧 Session State — Текущая работа

**Current task:** —
**Recent changes:** —
**Open questions:** —

---

## 📋 Memory Management Rules

### Pipeline Processing

1. **New lessons** → записывать в Lessons (Inbox) СРАЗУ
2. **3+ похожих lessons** → группировать в Short-Term для осмысления
3. **Extracted principle** → переместить в Long-Term как Протокол
4. **Processed lessons** → архивировать или удалять

### Session Start Checklist

- [ ] **Review Protocols:** Прочитать Long-Term Memory (инструкции к проекту)
- [ ] **Check Inbox:** Есть ли необработанные уроки?
- [ ] **Load Context:** Восстановить Session State

### Session End Checklist

- [ ] **Capture Lessons:** Были ли решены неочевидные проблемы? → Inbox
- [ ] **Update State:** Записать текущий прогресс
- [ ] **Commit:** Сохранить изменения MEMORY.md

---

## 🏗️ Project Architecture Quick Reference

**Key Directories:**
- `app/components/navigation/` - DashboardNav, Breadcrumbs, navConfig
- `locales/{en,ru,uk}/translation.json` - All UI strings
- `config/schemas/zod/` - AI structured output schemas
- `api/clients/` - AI integration clients

**Workspaces:**
- `/dashboard` - Sermons list (main workspace)
- `/series` - Series management
- `/studies` - Bible notes workspace
- `/groups` - Groups workspace (preview)
- `/settings` - User settings

**Key Patterns:**
- Tests: `npm run test` (NOT `npx jest` directly)
- Colors: Use `@/utils/themeColors`, never hardcode
- Comments: English only in code
