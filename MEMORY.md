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

**Current session:** Audio Recorder Pause/Resume feature implementation - added pause functionality to all audio recorder variants with UX improvements.

**Recent changes:**
- **AudioRecorder (Standard & Mini variants):**
  - Added `isPaused` state and `pauseRecording()`/`resumeRecording()` functions
  - Main button = always Stop (sends recording), separate Pause/Resume button
  - Fixed state reset: `setIsPaused(false)` in `stopRecording()`, `handleError()`, `cancelRecording()`
  - Added hover effects: `hover:scale-110` (Mini), `hover:scale-105` (Standard)
  - Visual feedback: progress bar turns yellow when paused, animations stop
  
- **FocusRecorderButton (Normal & Small sizes):**
  - Added pause/resume with small button (top-left corner)
  - Main circular button = always Stop, small buttons = Pause/Resume (left) + Cancel (right)
  - Added hover effects: `hover:scale-125` for small buttons (better targeting)
  - Button color: red when recording/paused, yellow→green for pause→resume transition
  
- **Translations:** Added `audio.pauseRecording` and `audio.resumeRecording` to en/ru/uk locales
- **Documentation:** Created `AUDIO_RECORDER_PAUSE_FEATURE.md` with complete feature documentation
- **All tests pass:** 40/40 tests green, no linter errors

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

### Lesson: Audio Recorder Pause Feature - Research150 Prevents Multiple Iterations

**Problem:**
- Adding pause/resume functionality to AudioRecorder took multiple expensive iterations and bug fixes due to insufficient initial research and not following existing working patterns.
- Issues encountered: wrong button behavior (main button changing function), state not resetting (isPaused staying true), poor UX (small buttons without hover feedback), and user confusion about which button does what.

**Wrong Paths:**
1. **First implementation:** Made main button change function on pause (Stop → Resume). This contradicted the working Mini variant pattern.
2. **State management:** `stopRecording()` only reset `isRecording` but not `isPaused`, causing next recording to start in paused state.
3. **UX oversight:** Small buttons (16px) had no hover effects, making them hard to target and causing accidental clicks.
4. **Pattern inconsistency:** Each variant (standard/mini/focus) had different behaviors instead of following one proven pattern.

**Root Cause:**
- **Failed to apply Research150:** Did NOT read entire existing component before making changes. Mini variant ALREADY had the perfect pattern but wasn't used as reference.
- **Ignored "Copy What Works" principle:** When there are multiple variants of a component, find the BEST working one and replicate its pattern. Mini variant was the gold standard but was discovered only after user testing.
- **Incomplete state lifecycle thinking:** Added new state (`isPaused`) but didn't trace through ENTIRE lifecycle: start → pause → resume → stop → start again.
- **UX as afterthought:** Didn't consider user interaction patterns (hover feedback, button sizing, visual clarity) during initial implementation.

**Correct Solution:**
1. **Pattern discovery:** User tested Mini variant and identified it as perfect - used it as template for all other variants.
2. **Unified behavior:** Main button = ALWAYS Stop (sends recording), Separate button = Pause/Resume control.
3. **Complete state reset:** Added `setIsPaused(false)` in ALL exit points: `stopRecording()`, `handleError()`, `cancelRecording()`.
4. **UX enhancements:** Added `hover:scale-125` for small buttons (FocusRecorderButton), `hover:scale-110` for medium (Mini), `hover:scale-105` for large (Standard).

**Best Practice:**
1. **ALWAYS Research150 BEFORE implementing:** When adding functionality to existing components with variants, read ALL variants completely and identify the best-working one.
2. **"Copy What Works" principle:** If one variant works perfectly (like Mini), use it as the template for others. Don't reinvent patterns.
3. **Complete state lifecycle verification:** For any new state variable, trace through EVERY possible state transition path and ensure proper cleanup/reset at ALL exit points.
4. **UX-first thinking:** Consider user interaction patterns DURING initial design, not as afterthought:
   - Buttons <24px need hover effects (scale 110-125%)
   - Visual feedback for state changes (color, animation, icons)
   - Clear affordances (what's clickable, what happens when you click)
5. **Test immediately after implementation:** Don't stack multiple changes. Implement → test with user → fix → test again. Each iteration should be complete.
6. **Listen to user feedback patterns:** "Mini works perfect" = golden signal to replicate that pattern everywhere.

**Attention Points:**
- **Multi-variant components:** When component has standard/mini/micro variants, ALWAYS check if one variant already solves your problem perfectly - replicate its pattern.
- **State management checklist:** For new state variables, verify reset in: normal exit, error handling, cancellation, timeout, and re-initialization.
- **MediaRecorder API specifics:** `pause()` and `resume()` don't stop recording - `stop()` is the only way to send blob. Test that pause/resume doesn't trigger `onstop` handler.
- **Small button UX (<24px):** MUST have hover effects (scale or highlight) + adequate spacing + z-index to prevent misclicks.
- **Button hierarchy clarity:** In interfaces with multiple buttons, make primary action (Stop/Send) most prominent, secondary actions (Pause/Resume) clearly separate and visually distinct.
- **Test ALL flows:** start → pause → resume → stop → start (clean state?), start → pause → stop (sends?), start → stop (baseline).

**Lessons Extracted:**
- Research150 isn't optional - it prevents expensive iterations
- Working code in your codebase is often the best documentation
- State lifecycle bugs are silent until user testing - trace manually
- UX problems compound technical complexity - design for humans first
- User's "this works perfectly" feedback = architectural pattern to replicate

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
