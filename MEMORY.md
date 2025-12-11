# Project Memory (Learning Pipeline)

> **Принцип:** Memory — это не хранилище, а pipeline обучения.  
> **Flow:** Lessons (сырые) → Short-Term (осмысление) → Long-Term (принципы)

---

## 🆕 Lessons (Inbox) — Только что выучено

> Сырые записи о проблемах и решениях. Записывать СРАЗУ после подтверждения пользователя.

### 2025-12-11 Search snippets must include tags
**Problem:** При поиске по тегам сниппеты показывали только текст мыслей или пустоту, теги выводились отдельно и были не видны, если совпадение было только по тегу.
**Attempts:** Добавлял отдельные блоки для тегов → получалось два бордера; без текста сниппет не отображался.
**Solution:** Собрал единый сниппет на мысль: текстовый фрагмент + все совпавшие теги в одном блоке; добавил fallback текста мысли при совпадении только по тегу; нормализовал переносы/пробелы, теги подсвечиваются внутри сниппета.
**Why it worked:** Один контейнер объясняет “почему найдено” и по тексту, и по тегам; fallback гарантирует видимость матча; чистка whitespace убирает визуальный шум.
**Principle:** Если совпадение только в тегах, всё равно показывай один сниппет с текстом и тегами вместе, чтобы причина совпадения была видна.

### 2025-12-11 Inline highlight breaks words
**Problem:** Подсветка внутри слова (e.g., “прим” в “примеров”) рвала слово переносом строки: `<mark>` создавал разрыв и ломал верстку сниппета.
**Attempts:** Нормализовывал whitespace и убирал переносы внутри слова — улучшило, но разрывы оставались, когда браузер ставил перенос между `<mark>` и текстом.
**Solution:** Добавил word-joiners вокруг `<mark>`, `white-space: nowrap` на подсвеченной части и `word-break: keep-all` на контейнере сниппета; сохранил очистку переносов внутри слов.
**Why it worked:** Запретил браузеру разбивать слово между подсвеченной и непосвещенной частью и убрал скрытые переносы, поэтому слово осталось цельным.
**Principle:** При подсветке части слова всегда запрещай переносы (joiner + nowrap/keep-all) и очищай переносы внутри слова, иначе подсветка ломает слово.

### 2025-12-11 Landing tests must allow multiple headings
**Problem:** Тест landing падал из-за ожидания одного h1/h2, тогда как страница имеет несколько заголовков (header + hero) и badge для welcome.
**Attempts:** Переключал `getByRole` на `getAllByRole`, но оставался фейл на h2 (несколько заголовков).
**Solution:** Проверяю наличие текста через `getAllByRole(...).some(...)` для h1 и через прямой `getByText` для welcome (badge/span), избегая жёсткой монополии на один заголовок.
**Why it worked:** Тест адаптирован к реальной структуре страницы с множественными заголовками и не ломается при добавлении новых секций.
**Principle:** Когда страница содержит несколько h1/h2, проверки должны быть tolerant: ищи нужный текст среди всех, либо проверяй текст напрямую, а не предполагая единственность заголовка.

### 2025-12-11 Responsive toolbar keeps search primary
**Problem:** После перестройки тулбара поле поиска сжималось — основной input стал короче селектов, визуально “уменьшился”.
**Attempts:** Менял порядок элементов — не помогло; ограничение ширины оставалось.
**Solution:** Убрал `max-width` ограничения для поиска, дал `flex-1` + `min-w` и вынес чекбоксы в отдельную строку под строкой поиска/селектов.
**Why it worked:** Основной контрол получил гибкую ширину, а вторичные контролы не отнимают у него место на одной линии.
**Principle:** В тулбаре поиска оставляй инпут гибким (`flex-1` без max-width), фильтры/чекбоксы — отдельно или в отдельных столбцах, чтобы не сжимать поиск.

### 2025-12-11 Jest mocks must match component exports
**Problem:** Тесты LoginOptions падали с “Element type is invalid” из-за отсутствия моков для используемой иконки и устаревших CSS ожиданий.
**Attempts:** Перезапускал тесты — без изменений; проблема оставалась.
**Solution:** Замокал все используемые иконки (включая CheckIcon) и обновил проверки классов до актуальных (`from-blue-600 to-purple-600`, `bg-amber-100/50 border-amber-400`).
**Why it worked:** Компонент стал рендериться в тестах, а ассерты соответствуют реальным классам.
**Principle:** При моках общих компонентов (иконки) мокай каждый экспорт, который использует компонент, и держи тестовые ожидания классов синхронизированными с версткой.

---

## 🔄 Short-Term Memory (Processing) — На осмыслении

> Lessons которые нужно обработать. Группировать похожие, извлекать принципы.

### React State Dependencies (группа из 3+ lessons)

**Related lessons:** useEffect Infinite Loop, Search Logic Stability, Highlighting Integration
**Common pattern:** Проблемы возникают когда React dependencies нестабильны
**Emerging principle:** 
- Computed arrays/objects ВСЕГДА нестабильны — конвертировать в primitives
- RegExp на original string безопаснее чем index manipulation
- Override ALL content blocks in Markdown renderer, не только `p`
**Confidence:** High (подтверждено многократно)

### Search UX Patterns (группа)

**Related lessons:** Search Must Match User's View, Show "Why It Matched", Visual Snippet Visibility
**Common pattern:** Поиск должен работать с точки зрения ПОЛЬЗОВАТЕЛЯ
**Emerging principle:**
- Искать по ОТОБРАЖАЕМЫМ значениям, не по internal storage
- Если match в metadata — показать metadata в результатах
- Snippet должен ВСЕГДА показывать matched word (не обрезать CSS)
**Confidence:** High

---

## 💎 Long-Term Memory (Knowledge Base) — Интернализированные принципы

> Осмысленные, проверенные временем правила. Формат: "При X — ВСЕГДА делай Y"

### 🎨 UI/Layout Principles

**Collapsible Panels:**
При добавлении collapsible columns — ВСЕГДА синхронизировать `grid-template-columns` И `col-span` вместе.

**Long Content Components (10K+ words):**
Все action buttons (Edit/Delete) ДОЛЖНЫ быть в header — НИКОГДА внизу scrollable content.

**Modal → Drawer Migration:**
Primary benefit — MORE SPACE. Drawer widths: text labels (`30%` | `50%` | `100%`), НЕ abstract icons.

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

**useEffect Dependencies:**
НИКОГДА не использовать computed arrays/objects как dependencies. Конвертировать в primitive string.

### 🧪 Testing Discipline

**Post-Change Testing:**
После ЛЮБОГО изменения (UI/text/accessibility) — run test suite НЕМЕДЛЕННО.
Command: `npm run test` (НЕ `npx jest`).

### 🌍 Localization Principles

**Multi-Locale Updates:**
Перед редактированием ЛЮБОГО текста: `grep` key across ALL locales. Update ALL 3 (en/ru/uk) в одном commit.

### 🤖 AI Integration Principles

**Structured Output:**
Zod schemas + `zodResponseFormat()` + `beta.chat.completions.parse()`. Eliminates fragile XML/regex parsing.

**Scripture References:**
Book names MUST be English for `referenceParser.ts` compatibility. Explicit per-field language rules in prompts.

### 🔍 Search & Highlighting Principles

**Search Matching:**
ВСЕГДА искать по DISPLAYED values, не internal storage. User searches what they see.

**Highlighting:**
`regex.exec(originalContent)` — единственный safe way для indices. Map ALL content blocks в Markdown renderer.

### 📱 Interactive Components

**Audio Recorder:**
Main button = ALWAYS primary action. Reset ALL state variables at ALL exit points.

### 🧭 Navigation & Architecture

**Next.js 15:**
Route params MUST be awaited: `Promise<{ id: string }>` and `await params`.

---

## 🔧 Session State — Текущая работа

**Current task:** agents.mdc и MEMORY.md restructuring
**Recent changes:** 
- agents.mdc: Added Dynamic Framework Synthesis
- agents.mdc: Added Lesson Recording Protocol with mandatory trigger
- agents.mdc: Rebuilt Memory Architecture as Learning Pipeline
- agents.mdc: Added Frameworks as Personality Documentation
- MEMORY.md: Restructured with new pipeline format

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
