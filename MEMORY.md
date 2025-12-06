# Project Memory

## 🔄 Memory Management Rules
- Maintain this file in the project root alongside AGENTS/agents rules.
- Record new lessons after fixing UI/logic issues, then distill into Long-Term actionable advice.
- Keep short-term notes focused on current session state.

---

## 📚 Long-Term Memory (Actionable Guidelines)

### 🎨 UI/Layout Patterns

**Collapsible Panels:**
- When adding collapsible columns, ALWAYS sync both `grid-template-columns` AND `col-span` values together.
- Bind chevron rotation to state (`rotate-180` when `showForm`), unify icon sizes across states.
- Use `items-stretch` to maintain height parity between panels.

**Grid Layout Safety:**
- After any layout refactor, check for duplicate render issues.
- Test collapsed AND expanded states for vertical alignment.

### 🖱️ UX Consistency Rules

**Input Interactions:**
- Sibling inputs (tags, references) MUST have identical interaction affordances.
- ALWAYS provide both keyboard (Enter) AND clickable button for add actions.
- After add: reset input, dedupe values, maintain focus.

**Clickable Cards:**
- Use `onClick` + `router.push()` for card navigation (NOT nested `<Link>`).
- Add `cursor-pointer` class, write tests that verify navigation URLs.
- Check for nested interactive elements that could cause double navigation.

### 🌍 Localization Best Practices

**Multi-Locale Updates (CRITICAL):**
1. Before editing ANY text: `grep` the key across ALL `locales/` files.
2. Update ALL 3 locales (en/ru/uk) together in same commit.
3. Sync navigation description with workspace helper text.
4. Keep functional meaning consistent, not just wording.

**When Removing Keys:**
- Search codebase for usage before deleting from translation files.
- Remove from ALL locale files simultaneously.

### 🤖 AI Integration Guidelines

**Structured Output (PREFERRED):**
- Location: `config/schemas/zod/*.zod.ts` for schemas.
- Use `zodResponseFormat()` + `beta.chat.completions.parse()` for type-safe responses.
- Feature flag: `USE_STRUCTURED_OUTPUT` for gradual migration.
- Eliminates fragile XML/regex parsing, provides automatic validation.

**AI Response Post-Processing:**
- ALWAYS validate/normalize AI output before using.
- Clean redundant data: if `toVerse === fromVerse`, remove `toVerse`.
- Check edge cases: invalid ranges, semantic redundancy.

**Multilingual AI Prompts:**
- Detect input language via `/[\u0400-\u04FF]/` regex (Cyrillic).
- Explicitly state per-field language rules: "Title in note's language, Scripture books ALWAYS in English".
- Include examples in prompt for mixed-language requirements.
- Scripture book names MUST be English for `referenceParser.ts` compatibility.

**Voice Input Pattern:**
- Use existing `AudioRecorder` component with AI polishing.
- Simple focused prompt: grammar, spelling, filler word removal.
- Append polished text directly (skip preview step for faster UX).
- Support multiple recordings that append to same field.

### 🖱️ Drag & Review UX
- When items are locked (e.g., reviewed outline points), disable drag listeners and remove grab cursors/hover affordances; keep a clear “locked” cue instead of implying draggability.
- Preserve normal pointer/touch behavior for locked items (no forced touch-action) to avoid false affordances.

### 🧭 Navigation & Architecture

**Naming Consistency:**
- Navigation labels MUST match actual page content semantically.
- Breadcrumbs should use context-aware roots based on URL segment.
- Key files: `navConfig.ts`, `Breadcrumbs.tsx`, `locales/*/translation.json`.

**When Renaming Navigation Items:**
1. Update `navConfig.ts` (key + labelKey + defaultLabel)
2. Update `Breadcrumbs.tsx` logic for context-dependent root
3. Update/remove translation keys in ALL locales
4. Update related tests

**Breadcrumbs Architecture:**
- Root element determined by first URL segment: `/sermons/*` → "Sermons", `/series/*` → "Series", etc.
- Each section has its own root (no shared "Library" parent).

### 📊 Data Modeling Patterns

**Discriminated Unions:**
- When data has multiple valid configurations, use explicit `type`/`scope` field.
- Example: `ScriptureReference.scope`: `book` | `chapter` | `chapter-range` | `verses`.
- UI adapts fields based on type selection.
- Update AI prompts to return appropriate type values.

---

## 📝 Short-Term Memory

**Current session:** Next.js 15.5.7 + React 19 upgrade, fixed API route param typings, cleaned prep-mode tests/build, resolved nested button hydration issue.

**Recent changes:**
- Upgraded deps: `next@15.5.7`, `react@19.2.1`, `react-dom@19.2.1`, `eslint-config-next@15.5.7`, `@hello-pangea/dnd@18.0.1`, `lucide-react@0.556.0`.
- Fixed API routes requiring awaited params (Next 15): `app/api/sermons/[id]`, `/brainstorm`, `/plan`, `/generate-outline-points`, `app/api/series/[id]`, `/series/[id]/sermons`, `app/api/studies/materials/[id]`, `app/api/studies/notes/[id]` now use `params: Promise<{id}>` with `await`.
- Resolved PrepModeToggle flakiness under React 19: stabilized loading flags and tests/e2e with `findByRole`/`waitFor`.
- Fixed nested button hydration error in `StudyNoteCard`: header uses a single button row; analyze button sits alongside.
- All tests green (`npm run test:fast`), build succeeds (`npm run build`).

---

## 🎓 Lessons & Patterns

### Lesson: Always run tests after changes

**Problem:**
- A UI tweak (chevron relocation) was merged without immediately running the full or relevant test suite, causing translation coverage tests to fail later (missing `common.expand`/`common.collapse` keys).

**Wrong Paths:**
- Relied on targeted component tests only; skipped running broader suites that include translation coverage.
- Assumed UI-only change wouldn’t impact i18n, missed new translation keys introduced by accessibility props.

**Root Cause:**
- Process gap: no mandatory post-change test run, especially when adding new text/aria labels that require locale updates.

**Correct Solution:**
- Added the missing translation keys to all locales (en/ru/uk) and re-ran translation coverage tests to greenlight the suite.

**Best Practice:**
- After any change (especially UI/text/accessibility), run at least the relevant test suites (and ideally the full suite if time permits) before handoff. Always account for i18n impacts when adding aria-labels or visible text.

**Attention Points:**
- New labels/aria/text → update all locales + run translation coverage tests.
- Prefer running `npm run test -- --watch=false` (or targeted suites when appropriate) immediately after code edits to catch regressions early.

### Lesson: Next.js 15 route params must be awaited

**Problem:** Next 15 requires `params` to be awaited; routes with `{ params: { id: string } }` failed type checks during build.

**Root Cause:** Next 15 (app router) expects `params` as `Promise`, so synchronous destructuring breaks type validation.

**Correct Solution:** Type handlers as `{ params: Promise<{ id: string }> }` and `const { id } = await params;` across GET/PUT/POST/DELETE.

**Best Practice:** For all app router API routes, default to async params signature and `await params` to stay compatible with Next updates.

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
