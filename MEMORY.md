# Project Memory (Learning Pipeline)

> **Принцип:** Memory — это не хранилище, а pipeline обучения.  
> **Flow:** Lessons (сырые) → Short-Term (осмысление) → Long-Term (принципы)

---

## 🆕 Lessons (Inbox) — Только что выучено

> Сырые записи о проблемах и решениях. Записывать СРАЗУ после подтверждения пользователя.

- **SonarJS cognitive complexity в React JSX:** вынесение helper-функций может не снижать score — условный JSX тоже считается; если warning висит на компоненте, выноси крупные секции UI в мелкие компоненты/рендер-хелперы (без изменения behavior).
- **Перед добавлением тестов — ищи существующие:** для `KnowledgeSection` тесты уже были в `frontend/__tests__/components/KnowledgeSection.test.tsx`; лучше расширять существующие сценарии, чем плодить новый файл в другом месте.

---

## 🔄 Short-Term Memory (Processing) — На осмыслении

> Lessons которые нужно обработать. Группировать похожие, извлекать принципы.

### Component Prop Cleanup Pattern (for next processing)

**Related lessons:** Timer components cleanup, unused variables batch
**Common pattern:** When removing unused props, must update multiple locations
**Emerging principle:** 
- Update TypeScript interface
- Update component destructuring  
- Update all call sites
- Run tests to catch missed usages
**Confidence:** High

---

## 💎 Long-Term Memory (Knowledge Base) — Интернализированные принципы

> Осмысленные, проверенные временем правила. Формат: "При X — ВСЕГДА делай Y"

### 🔧 ESLint & Linting Principles

**Duplicate Strings → Constants:**
При ESLint sonarjs/no-duplicate-string — создавать константы в начале файла. Для 3+ повторений → обязательно константа.

**Cognitive Complexity → Helper Functions:**
При cognitive complexity > 20 — выделять helper functions. Каждая функция = single responsibility. НЕ менять business logic при рефакторинге.
Для React компонентов: если warning висит на функции компонента — выноси большие JSX/conditional render блоки в отдельные компоненты/рендер-хелперы, иначе complexity может не упасть.

**Jest Mock String Literals (CRITICAL):**
`jest.mock()` выполняется во время **module loading phase**, ДО выполнения JS кода. Строковые литералы в `jest.mock()` ОБЯЗАТЕЛЬНЫ — константы вызывают "Cannot access before initialization". Принять дублирование как framework constraint.

**Translation Key Coverage:**
При добавлении новых `t()` ключей — ОБЯЗАТЕЛЬНО добавлять во ВСЕ языковые файлы (en/ru/uk) сразу. Иначе упадут translation coverage tests.

**Framework Constraints Win:**
Когда ESLint правила конфликтуют с framework requirements (Jest mocks, Testing Library) — framework constraints имеют приоритет. Принять некоторые warnings как acceptable.

**Circular Constant References:**
При replace_all ВСЕГДА проверять результат на self-reference: `const X = X` — НЕПРАВИЛЬНО. `const X = 'value'` — ПРАВИЛЬНО.

### 🔄 React Hooks Principles

**useEffect Dependencies — Primitives Only:**
НИКОГДА не использовать computed arrays/objects как dependencies. Конвертировать в primitive string (IDs join).

**State Transition Effects:**
Для effects на state transitions — использовать useRef для tracking previous value. Guard execution: `if (prevRef.current && !current)`.

**Missing Imports Break Runtime:**
ESLint может пропустить missing hook imports, но runtime сломается. При добавлении useMemo/useCallback — ВСЕГДА проверять импорты.

**useCallback for Function Dependencies:**
Если функция используется в dependency array — оборачивать в useCallback. Или перемещать внутрь эффекта.

### 🔍 Search & Highlighting Principles

**Search Matching — User's View:**
ВСЕГДА искать по DISPLAYED values, не internal storage. User searches what they see.

**Snippets Show WHY Matched:**
Если match только в tags — показывать tags в snippet. Один контейнер для text + tags. Fallback текста при tag-only match.

**Inline Highlights — No Word Breaks:**
При подсветке части слова — добавлять word-joiners, `white-space: nowrap` на mark, `word-break: keep-all` на container. Иначе слово разорвётся.

**Highlighting Implementation:**
`regex.exec(originalContent)` — единственный safe way для indices. Map ALL content blocks в Markdown renderer.

### 🧪 Testing Principles

**Jest Mocks — Match ALL Exports:**
При моках компонентов с иконками — мокать КАЖДЫЙ используемый экспорт. "Element type is invalid" = missing mock.

**Browser APIs Need Mocks:**
JSDOM не реализует window.matchMedia, ResizeObserver. При тестировании responsive компонентов — ОБЯЗАТЕЛЬНО добавлять mock с полным интерфейсом.

**Test Class Expectations — Keep Synced:**
При изменении CSS классов в компонентах — обновлять тестовые ожидания. Классы в assertions должны соответствовать реальной верстке.

**Testing Library waitFor:**
`waitFor()` только для проверок условий, НИКОГДА для actions. Использовать `findAllByTestId()` + `fireEvent.click()`.

**Modern Catch Blocks:**
Catch block без параметров: `} catch {` вместо `} catch (_error) {`. Eliminates unused variable warnings.

**ESLint Fixes → Run Tests:**
После ЛЮБЫХ ESLint исправлений — НЕМЕДЛЕННО запускать тесты. ESLint fixes могут ломать функциональность.

### 🎨 UI/Layout Principles

**Collapsible Panels:**
При добавлении collapsible columns — ВСЕГДА синхронизировать `grid-template-columns` И `col-span` вместе.

**Long Content Components (10K+ words):**
Все action buttons (Edit/Delete) ДОЛЖНЫ быть в header — НИКОГДА внизу scrollable content.

**Modal → Drawer Migration:**
Primary benefit — MORE SPACE. Drawer widths: text labels (`30%` | `50%` | `100%`), НЕ abstract icons.

**Toolbar Search — Stay Flexible:**
В тулбаре поиска — input с `flex-1` без max-width. Фильтры/чекбоксы отдельно или в другой row, чтобы не сжимать поиск.

**Multiple Headings in Tests:**
Страницы могут иметь несколько h1/h2. Использовать `getAllByRole(...).some(...)` или `getByText` вместо единственного `getByRole`.

### 🖱️ UX Consistency Principles

**Input Interactions:**
Sibling inputs (tags, references) ДОЛЖНЫ иметь идентичные interaction affordances. ВСЕГДА keyboard (Enter) + clickable button.

**Clickable Cards:**
`onClick` + `router.push()` для navigation. Проверять nested interactive elements. Actions в header.

**Text Labels vs Icons:**
Для size/mode toggles — TEXT labels. Abstract icons (⊡, ⤢) создают confusion.

### 🔄 State Management Principles

**State Lifecycle:**
При добавлении ЛЮБОЙ state variable — trace через ВЕСЬ lifecycle: init → transitions → ALL exit points.
Особенно проверять reset в: normal exit, error handling, cancellation, timeout.

### 🏗️ Build & TypeScript Principles

**Systematic Build Debugging:**
При множественных TypeScript ошибках — фиксить систематически:
1. Понять API каждого проблемного места
2. Предпочесть working code над perfect typing
3. Тестировать каждое изменение отдельно

**DnD Types:**
`dragHandleProps` может быть null — добавлять `| null` к типам.

**StudyNote Creation:**
Исключать server-only поля (id, createdAt, updatedAt) при создании объектов.

### 🌍 Localization Principles

**Multi-Locale Updates:**
Перед редактированием ЛЮБОГО текста: `grep` key across ALL locales. Update ALL 3 (en/ru/uk) в одном commit.

### 🤖 AI Integration Principles

**Structured Output:**
Zod schemas + `zodResponseFormat()` + `beta.chat.completions.parse()`. Eliminates fragile XML/regex parsing.

**Scripture References:**
Book names MUST be English for `referenceParser.ts` compatibility. Explicit per-field language rules in prompts.

### 🧭 Navigation & Architecture

**Next.js 15:**
Route params MUST be awaited: `Promise<{ id: string }>` and `await params`.

---

## 🔧 Session State — Текущая работа

**Current task:** MEMORY.md processing — lessons consolidated
**Recent changes:**
- Processed 30+ lessons from Inbox
- Extracted principles to Long-Term Memory
- Grouped related patterns
- Cleaned up processed lessons

**Open questions:** None currently

---

## 📋 Memory Management Rules

### Pipeline Processing

1. **New lessons** → записывать в Lessons (Inbox) СРАЗУ
2. **3+ похожих lessons** → группировать в Short-Term для осмысления
3. **Extracted principle** → переместить в Long-Term
4. **Processed lessons** → архивировать или удалять

### Session Start Checklist

- [ ] Read Long-Term Memory (мои интернализированные знания)
- [ ] Check Lessons (Inbox) — есть ли необработанные?
- [ ] If 3+ similar lessons → process to Short-Term
- [ ] Load Session State from previous session

### Session End Checklist

- [ ] "Были ли solved problems?" → If yes, записал ли lessons?
- [ ] Update Session State for next session
- [ ] Commit MEMORY.md changes if significant

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
