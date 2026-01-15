# Project Memory (Project Operating Manual)

> **Принцип:** Memory — это не хранилище, а pipeline обучения.
> **Flow:** Lessons (сырые) → Short-Term (осмысление) → Long-Term (инструкции)

---

## 🆕 Lessons (Inbox) — Только что выучено

> Сырые записи о проблемах и решениях. Записывать СРАЗУ после подтверждения пользователя.

### 2026-01-14 Calendar Analytics Refactor Verified
**Problem:** `AnalyticsSection.tsx` exceeded `sonarjs/cognitive-complexity`, and a safe refactor needed high-confidence behavior parity.
**Attempts:** Researched refactor options and verified existing behavior boundaries via tests and data flow inspection.
**Solution:** Extracted analytics computation into `calendarAnalytics.ts`, split logic into pure helpers, expanded unit tests, ran full test suite + lint, and manually compared prod vs localhost.
**Why it worked:** Moving complex logic into pure utilities reduced complexity without UI changes; tests plus manual parity check validated behavior.
**Principle:** To reduce cognitive complexity safely, extract pure logic into utilities, keep UI thin, and validate with targeted tests plus full-suite and real-world parity checks.

### 2026-01-14 KnowledgeSection Refresh Should Update sectionHints
**Problem:** Refresh button in “Suggested Plan” visually referenced section hints but called full-plan generation, so UI appeared unchanged when sectionHints existed.
**Attempts:** Investigated UI triggers and backend routes to verify actual API calls.
**Solution:** Wire the refresh action to `generateThoughtsBasedPlan` (`POST /api/insights/plan`) and update tests to assert this call.
**Why it worked:** The button now refreshes the data source it renders (`insights.sectionHints`), eliminating the mismatch between UI expectations and side effects.
**Principle:** Refresh actions must update the same data source that the UI section renders; otherwise users perceive a “no-op” and confusion.

### 2026-01-11 Decoupling Complex Component Logic (Refactoring Protocol 150)
**Problem:** `handleSaveEdit` in `page.tsx` had a cognitive complexity of 42 due to nested loops, redundant state checks, and interleaved server/UI logic.
**Attempts:** Initially extracted logic to sub-functions within the component, which reduced complexity but didn't improve testability or structural clarity.
**Solution:** (1) Extracted pure data transformation helpers (`findOutlinePoint`, `buildItemForUI`) to `utils/structure.ts`. (2) Extracted interaction handlers and related state (`handleSaveEdit`, `handleCreateNewThought`, etc.) to a custom hook `useSermonActions.ts`. (3) Verified with 174 targeted unit tests and manual browser validation.
**Why it worked:** Custom hooks allow encapsulating related state and effects, making the main component declarative. Pure utilities in separate files enable 100% test coverage without component overhead.
**Principle:** When a component's handler logic exceeds complexity limits, decouple stateful interactions into custom hooks and pure business logic into utilities for isolation and testability.

### 2026-01-12 Testing Async UI Interaction updates
**Problem:** Test failed to find a newly added tag element after simulated user input, despite using `waitFor`.
**Attempts:** `userEvent.type` + `userEvent.click` failed to update state fast enough for `getByText`.
**Solution:** (1) Use `fireEvent.change` for reliable input value setting in JSDOM. (2) Use `await screen.findByText` instead of `getByText` to leverage built-in retry mechanisms for element appearance.
**Why it worked:** `fireEvent` is synchronous and direct; `findBy` queries are async and poll the DOM, handling React's render cycle delays automatically.
**Principle:** When asserting the presence of elements appearing after an interaction, prefer `await screen.findBy*` over `waitFor(() => screen.getBy*)` for cleaner and more reliable tests.

### 2026-01-11 JSDOM window override for SSR branches
**Problem:** Needed to cover the `typeof window === 'undefined'` branch in share URL tests, but JSDOM always provides `window`.
**Solution:** Override `global.window` using `Object.defineProperty` during the test and restore it afterward.
**Principle:** To exercise SSR-only branches in JSDOM, temporarily redefine `window` with `Object.defineProperty` instead of direct assignment.

### 2026-01-11 CSS Grid Header Alignment
**Problem:** Column headers didn't match values vertically in a table using CSS Grid due to calculating widths based on different content (text vs buttons).
**Solution:** Use fixed pixel widths for all metadata/action columns and only one `1fr` column for the primary flexible content.
**Why it worked:** Constraining all but one column ensures identical grid calculation for both header and rows regardless of inner content size.
**Principle:** For perfect Grid alignment between header and rows, use fixed widths for all metadata columns and only a single `1fr` column for flexible content.

### 2026-01-11 i18n labels update after mount in ThemeModeToggle
**Problem:** Theme mode tests failed because translated labels render after mount, and duplicate labels exist in sr-only elements.
**Attempts:** `getByText('System')` assertions failed with multiple matches and timing issues.
**Solution:** Use `waitFor` for mounted text and `getAllByText` (or more specific queries) to handle duplicates.
**Why it worked:** The component updates labels in `useEffect`, so waiting avoids race conditions; multiple matches are expected by design.
**Principle:** For i18n/mounted labels, use `waitFor` and `getAllByText` (or scoped queries) instead of assuming unique immediate text.

### 2026-01-11 Testing conditional visual states in UI components
**Problem:** Needed to test conditional styling (emerald vs gray) for share link icon based on hasShareLink prop, but no existing pattern for testing CSS classes in complex conditional logic.
**Solution:** Use `screen.getByRole('button', { name: 'aria-label' })` to target the specific button, then `expect(button).toHaveClass('expected-classes')` for each conditional class, testing both light and dark variants separately.
**Why it worked:** RTL's className assertions work reliably for conditional Tailwind classes; testing both states (hasShareLink true/false) ensures complete coverage.
**Principle:** For conditional visual states, test both true/false branches with explicit className assertions on targeted elements using ARIA labels for reliable selection.

### 2026-01-07 AudioRecorder test timing + matchMedia typing
**Problem:** New AudioRecorder coverage tests failed (keyboard shortcut stop didn’t fire; TypeScript complained about matchMedia mocks with undefined addEventListener).
**Attempts:** Triggered Ctrl+Space twice and asserted completion; mocked matchMedia with missing methods.
**Solution:** Wait for the stop button to render before sending the stop shortcut; cast legacy matchMedia mocks via `as unknown as MediaQueryList`.
**Why it worked:** The UI needs to transition to recording state before stop is handled; TS needs an explicit bridge when mocks intentionally omit interface members.
**Principle:** For async UI keyboard flows, wait for state-driven DOM before asserting side effects; when mocking partial Web APIs in TS, use `unknown` casts to satisfy structural typing.

### 2026-01-11 Testing dynamic UI class changes in React
**Problem:** Tests for dynamic modal width and drawer expansion failed because assertions used stale element references or fired before state updates finished.
**Attempts:** `expect(modalContainer).toHaveClass(...)` failed even after `userEvent.type`.
**Solution:** (1) Re-find the element inside `waitFor` to ensure it targets the updated DOM node. (2) Use `data-testid` for stable selection. (3) Use `fireEvent.change` for large text blocks instead of `userEvent.type` to speed up tests.
**Why it worked:** React re-renders might replace the DOM node; `waitFor` + fresh query ensures we check the latest state.
**Principle:** For dynamic UI class assertions, always re-query the element inside `waitFor` and use stable `data-testid` anchors.

### 2026-01-11 Threshold logic ordering for auto-expansion
**Problem:** Drawer wouldn't expand to fullscreen because the `medium` threshold (1000) was checked before `fullscreen` (2000) in an `if/else if` block.
**Solution:** Reorder logic to check the largest/most specific threshold first.
**Principle:** When implementing multi-threshold triggers, always evaluate conditions from most restrictive (largest) to least restrictive.

### 2026-01-11 exhaustive-deps vs functional updates
**Problem:** `useEffect` for auto-expansion had a lint warning because `size` was used in the logic but omitted from deps to avoid loops.
**Solution:** Use the functional update pattern `setSize((prev) => ...)` to read the current state without including it in the dependency array.
**Principle:** To avoid `exhaustive-deps` warnings and unnecessary effect re-runs when state logic depends on previous state, use the functional update pattern.

---

## 🔄 Short-Term Memory (Processing) — На осмыслении

> Lessons которые нужно обработать. Группировать похожие, извлекать принципы.

### UI/UX Consistency & Refactoring (3 lessons)
**Common Pattern:** UI changes that affect layout, alignment, and component structure
- Badge alignment in wrapped outline titles (2026-01-04)
- Focus sidebar refactor boundaries (2026-01-04)
- Safe UI modularization preserves DOM (2026-01-05)

**Emerging Principle:** UI refactoring requires preserving DOM structure and testing logical sections across all modes.

### Testing Quality & Coverage (4 lessons)
**Common Pattern:** Test failures and coverage gaps after changes
- Coverage requires changed-line verification (2026-01-04)
- Duplicate label tests need specific queries (2026-01-05)
- Mock override must beat default beforeEach (2026-01-05)
- Compile failures from typed test fixtures (2026-01-05)
- Dynamic UI class test failures (2026-01-11)

**Emerging Principle:** Tests must explicitly verify changed lines of dynamic UI (widths/heights) using fresh queries inside `waitFor` and stable anchors.

### Logic Decoupling & Protocol 150 (3 lessons)
**Common Pattern:** Extracting logic from monolithic components and validating with multi-layered testing.
- Refactor handleSaveEdit logic extraction (2026-01-11)
- Plan prompt refactor regression guard (2026-01-04)
- Calendar Analytics pure-logic extraction + parity verification (2026-01-14)

**Emerging Principle:** Decoupling logic into hooks/utils reduces cognitive complexity and enables focused tests; reinforce with full-suite + parity checks for confidence.

### Data Consistency (1 lesson)
**Pattern:** Export order divergence from UI order
- Export order mismatch in focus mode (2026-01-04)

**Emerging Principle:** Export ordering should match UI ordering source to prevent divergence.

### Refactoring Safety (1 lesson)
**Pattern:** Regression after helper extraction
- Plan prompt refactor regression guard (2026-01-04)

**Emerging Principle:** After helper extraction, audit downstream usage and add targeted tests for new paths.


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

**UI Refactoring Preservation**
*   **Context:** Рефакторинг UI компонентов с DOM-сенситивными тестами.
*   **Protocol:** Сохраняй ключевые классы/DOM структуру и проверяй логические секции в обоих режимах.
*   **Reasoning:** Предотвращает поломку UI и тестов при рефакторинге фокус-мода.

**Test Coverage Verification**
*   **Context:** Проверка что изменения покрыты тестами.
*   **Protocol:** Добавляй таргетированные тесты для новых DOM структур/классов и проверяй покрытие измененных строк.
*   **Reasoning:** Зеленые тесты могут не покрывать логику; явные assertions гарантируют выполнение.

**Mock Override Strategy**
*   **Context:** Переопределение shared моков в тестах.
*   **Protocol:** Используй `mockReturnValue` или reset внутри теста для полного переопределения beforeEach мока.
*   **Reasoning:** Гарантирует использование intended данных, а не дефолтного fallback.

**UI Label Duplication Handling**
*   **Context:** Тесты с повторяющимися лейблами в UI.
*   **Protocol:** Используй `getAllByText` или специфические селекторы когда UI дублирует лейблы.
*   **Reasoning:** Тесты перестают предполагать уникальность и соответствуют rendered DOM.

**Type-Safe Test Fixtures**
*   **Context:** TypeScript тесты с неполными моками.
*   **Protocol:** Трактуй test fixtures как first-class types — обновляй моки вместе с изменениями модели.
*   **Reasoning:** Tests являются частью TS программы; соблюдение контрактов модели убирает структурные ошибки.

**Export Order Alignment**
*   **Context:** Согласование порядка экспорта с UI порядком.
*   **Protocol:** Когда UI порядок определяется `ThoughtsBySection`, экспорт должен использовать тот же источник порядка.
*   **Reasoning:** Предотвращает расхождения между UI и экспортированными данными.

**Helper Extraction Audit**
*   **Context:** Рефакторинг с извлечением helper функций.
*   **Protocol:** После извлечения хелперов проверяй downstream использование и добавляй таргетированные тесты для новых путей.
*   **Reasoning:** Рефакторинг сохраняет поведение, новые тесты ловят пропущенные handoff между outputs.

---

## 📋 Memory Management Rules

### Pipeline Processing

1. **New lessons** → записывать в Lessons (Inbox) СРАЗУ
2. **3+ похожих lessons** → группировать в Short-Term для осмысления
3. **Extracted principle** → переместить в Long-Term как Протокол
4. **Processed lessons** → архивировать или удалять

### Session Logs

- **Single source:** Весь прогресс/исследования/решения идут в `.sessions/SESSION_[session_name].md`
- **Session State:** Не используется в MEMORY.md

### Session Start Checklist

- [ ] **Review Protocols:** Прочитать Long-Term Memory (инструкции к проекту)
- [ ] **Check Inbox:** Есть ли необработанные уроки?
- [ ] **Load Session Log:** Открыть актуальный `.sessions/SESSION_[session_name].md`

### Session End Checklist

- [ ] **Capture Lessons:** Были ли решены неочевидные проблемы? → Inbox
- [ ] **Update Session Log:** Записать текущий прогресс и решения в `.sessions/SESSION_[session_name].md`
- [ ] **Commit:** Сохранить изменения MEMORY.md

---

## 🏗️ Project Architecture Quick Reference

**Key Directories:**
- `app/components/navigation/` - DashboardNav, Breadcrumbs, navConfig
- `locales/{en,ru,uk}/translation.json` - All UI strings
- `config/schemas/zod/` - AI structured output schemas
- `api/clients/` - AI integration clients
- `app/(pages)/(private)/` - Auth-protected pages via `ProtectedRoute` layout
- `app/(pages)/share/` - Public share pages (no auth)
- `app/api/share/` - Public API endpoints (no auth, must sanitize output)

**Workspaces:**
- `/dashboard` - Sermons list (main workspace)
- `/series` - Series management
- `/studies` - Bible notes workspace
- `/groups` - Groups workspace (preview)
- `/settings` - User settings

**Sermon Structure Architecture:**
- `app/(pages)/(private)/sermons/[id]/structure/hooks/` - Feature-specific hooks (e.g., `useSermonActions`, `usePersistence`)
- `app/(pages)/(private)/sermons/[id]/structure/utils/` - Pure logic (e.g., `findOutlinePoint`, `buildItemForUI`)
- `app/(pages)/(private)/sermons/[id]/structure/page.tsx` - Main page orchestrator

- `app/(pages)/(private)/studies/constants.ts` - Shared study note constants and width utilities

**Key Patterns:**
- Tests: `npm run test` (NOT `npx jest` directly)
- Colors: Use `@/utils/themeColors`, never hardcode
- Auto-resize: Use `react-textarea-autosize` for growing textareas with `minRows`/`maxRows`
- Modal Width: Use `getNoteModalWidth` helper for dynamic max-width based on content
- Comments: English only in code
