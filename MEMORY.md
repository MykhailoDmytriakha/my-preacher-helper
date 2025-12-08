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

**Modal → Drawer Migration:**
- Primary benefit is MORE SPACE, not more features. Keep drawer simple.
- Drawer widths: use text labels (`30%` | `50%` | `100%`), NOT abstract icons.
- Include drag-to-resize handle on left edge.
- Persist user's preferred size in `localStorage`.

**Long Content Components (10K+ words):**
- ALL action buttons (Edit/Delete) MUST be in header — NEVER at bottom of scrollable content.
- Consolidate related toggles into single header row.
- Use sticky headers for forms inside scrollable containers.

### 🖱️ UX Consistency Rules

**Input Interactions:**
- Sibling inputs (tags, references) MUST have identical interaction affordances.
- ALWAYS provide both keyboard (Enter) AND clickable button for add actions.
- After add: reset input, dedupe values, maintain focus.

**Clickable Cards:**
- Use `onClick` + `router.push()` for card navigation (NOT nested `<Link>`).
- Add `cursor-pointer` class, write tests that verify navigation URLs.
- Check for nested interactive elements that could cause double navigation.
- Action buttons (Edit/Delete) go in card header, visible without expanding.

**Button Sizing & Feedback:**
- Buttons <24px MUST have hover effects (`scale-110` to `scale-125`).
- Visual feedback for state changes (color, animation, icons).
- Clear affordances: user must know what's clickable and what happens on click.

**Text Labels vs Icons:**
- For size/mode toggles: use TEXT (`30%`, `50%`, `100%`) unless icon is universal (✕, ←, ↺).
- Abstract icons (⊡, ⤢) cause user confusion — avoid.

### 🔄 State Management Patterns

**State Lifecycle Verification:**
- For ANY new state variable, trace through ENTIRE lifecycle: init → all transitions → all exit points.
- Verify reset in: normal exit, error handling, cancellation, timeout, re-initialization.
- Common bug: `isPaused` not reset in `stopRecording()` → next recording starts paused.

**Multi-Variant Components:**
- When component has standard/mini/micro variants, find the BEST working one and replicate its pattern.
- "Copy What Works" principle: if Mini variant works perfectly, use it as template for all.
- Working code in codebase = best documentation.

### 🧪 Testing Discipline

**Post-Change Testing (CRITICAL):**
- After ANY change (especially UI/text/accessibility), run test suite IMMEDIATELY.
- New labels/aria/text → update ALL locales → run translation coverage tests.
- Command: `npm run test` (never `npx jest` directly).
- Create comprehensive test file for new components immediately (15+ tests).

**Test All Flows:**
- For stateful components: test normal flow, edge cases, error states, re-initialization.
- Example: start → pause → resume → stop → start (clean state?).

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
- Eliminates fragile XML/regex parsing, provides automatic validation.

**AI Response Post-Processing:**
- ALWAYS validate/normalize AI output before using.
- Clean redundant data: if `toVerse === fromVerse`, remove `toVerse`.

**Multilingual AI Prompts:**
- Detect input language via `/[\u0400-\u04FF]/` regex (Cyrillic).
- Explicitly state per-field language rules: "Title in note's language, Scripture books ALWAYS in English".
- Scripture book names MUST be English for `referenceParser.ts` compatibility.

**Voice Input Pattern:**
- Use existing `AudioRecorder` component with AI polishing.
- Simple focused prompt: grammar, spelling, filler word removal.
- Append polished text directly (skip preview step for faster UX).

### 🖱️ Interactive Components

**Drag & Review UX:**
- When items are locked, disable drag listeners and remove grab cursors.
- Preserve normal pointer/touch behavior for locked items.

**Audio Recorder (Pause/Resume):**
- Main button = ALWAYS primary action (Stop/Send). Separate button for Pause/Resume.
- Reset ALL state variables at ALL exit points.
- MediaRecorder API: `pause()`/`resume()` don't send blob — only `stop()` does.

### 🧭 Navigation & Architecture

**Naming Consistency:**
- Navigation labels MUST match actual page content semantically.
- Breadcrumbs use context-aware roots based on URL segment.
- Key files: `navConfig.ts`, `Breadcrumbs.tsx`, `locales/*/translation.json`.

**Next.js 15 Compatibility:**
- Route params MUST be awaited: `{ params: Promise<{ id: string }> }` and `const { id } = await params;`.
- Apply to all app router API routes (GET/PUT/POST/DELETE).

### 📊 Data Modeling Patterns

**Discriminated Unions:**
- When data has multiple valid configurations, use explicit `type`/`scope` field.
- Example: `ScriptureReference.scope`: `book` | `chapter` | `chapter-range` | `verses`.
- UI adapts fields based on type selection.

### 🎯 Feature Development Process

**Validate Before Implementing:**
- For "nice-to-have" features, ask user BEFORE building: "Would you use X?"
- User saying "Jira-like" is a concept, NOT a spec — clarify before coding.
- "Remove it" is valid and valuable feedback — act on it immediately.

**Iterate Quickly:**
- Each feedback → fix → test cycle should be < 5 minutes.
- Don't stack multiple changes — implement → test → fix → test again.
- User feedback is faster than perfect implementation.

**Research150 Before Implementing:**
- Read ALL variants of existing components before adding functionality.
- Find the best-working variant and replicate its pattern.
- Prevents expensive multi-iteration implementations.

---

## 📝 Short-Term Memory

**Current session:** Search Highlighting in Study Notes

**Recent changes:**
- **HighlightedText.tsx:** New component for Chrome-style text highlighting
- **page.tsx:** Auto-expand effect, localized book name search
- **StudyNoteCard.tsx:** Highlighting for title, tags, scripture refs
- **MarkdownDisplay.tsx:** Text node highlighting in markdown content
- **Tests:** 1471 tests green across 188 suites

---

## 🎓 Lessons & Patterns

### useEffect Infinite Loop Prevention
**Problem:** Using `filteredNotes` (array) as useEffect dependency causes infinite loop because array is recreated on every render.
**Solution:** Create stable primitive (string) from array: `filteredNoteIds = filteredNotes.map(n => n.id).join(',')`. Use this primitive as dependency instead.
**Pattern:** When useEffect depends on computed array/object, convert to primitive string for stable comparison.

### Search Must Match User's View
**Problem:** Search was matching internal data (English book names in DB) instead of what user sees (localized names).
**Solution:** Use `getLocalizedBookName(ref.book, bibleLocale)` in search haystack.
**Pattern:** Always search/filter by DISPLAYED values, not internal storage values. User searches for what they see.

### Show "Why It Matched" (Empty Content, Matched Metadata)
**Problem:** User searches for term (e.g. "77") found ONLY in tags/refs. Collapsed card shows just title and empty snippets (since content didn't match), confusing the user.
**Solution:** If search matches metadata (tags, refs) but not content, explicitly display those matching metadata items in the collapsed view as "snippets".

### Highlighting Integration with ReactMarkdown
**Challenge:** ReactMarkdown uses component overrides, need to wrap text nodes.
**Solution:** Override `p`, `li`, `strong`, `em` components to wrap string children with `<HighlightedText>`.
**Key:** Check `typeof child === 'string'` before wrapping, pass through non-string children unchanged.

### Search Logic Stability (The Index Drift)
**Problem:** Using `content.toLowerCase().indexOf()` produced wrong indices because `toLowerCase()` can change string length (special chars/unicode), causing highlights to "drift" off target in long documents.
**Solution:** Use `RegExp` with ignore-case flag executing on the ORIGINAL string.
**Pattern:** `regex.exec(originalContent)` is the only safe way to get standard indices.

### Visual Snippet Visibility
**Problem:** Increasing context size pushed the search match to line 5+, but CSS `line-clamp-4` hid it. User saw a snippet *without* the searched word.
**Solution:** When displaying search snippets, disable or relax vertical truncation. Ensure the "center" of the snippet is always visible.

### Comprehensive Highlighting (Don't Forget Headers)
**Problem:** Implemented highlighting for standard text but ignored headers (`h1`-`h6`). User saw text unhighlighted in titles.
**Solution:** Explicitly map ALL content blocks (`h1`-`h6`, `blockquote`) in Markdown renderer to the highlighter component.

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
