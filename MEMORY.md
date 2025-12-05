# Project Memory

## 🔄 Memory Management Rules
- Maintain this file in the project root alongside AGENTS/agents rules.
- Record new lessons after fixing UI/logic issues, including problem, root cause, and best practice.
- Keep short-term notes focused on current session state; move durable insights to long-term when stable.

## 📚 Long-Term Memory
- Studies workspace: left column with collapsible filters (default closed) and notes list; right column note form collapses into a vertical tab with chevron + book icon, keeping matching height and rounded corners.
- Filters cover search, tag, book, untagged-only, no-scripture-only; filters panel uses chevron toggle.
- Stats simplified to total notes + distinct books; drafts/materials UI removed. Backend strips isDraft/materialIds/relatedSermonIds before persist/read.
- Quick scripture input parser; scripture refs start empty (no default Genesis 1:1); tag suggestions via datalist plus explicit "Add tag" button mirroring reference UX.
- Duplicate notes list fixed; only one notes grid remains.
- **Structured Output Architecture:** New AI calls use Zod schemas + `zodResponseFormat()` for type-safe responses. Modules: `config/schemas/zod/` (schemas), `api/clients/structuredOutput.ts` (utility), `*.structured.ts` (domain functions). Feature flag `USE_STRUCTURED_OUTPUT` for gradual migration.
- **AI Analyze for Studies:** Button on studies page extracts title, scripture refs (English book names), and tags from note content. Respects note language (RU/UK/EN) for title/tags.

## 📝 Short-Term Memory
- Current session: Implemented structured output for AI calls using Zod schemas + OpenAI SDK.
- Created modular architecture: `structuredOutput.ts` (utility), `thought.structured.ts`, `studyNote.structured.ts`.
- Added AI Analyze button to Studies page for extracting title, scripture refs, and tags from notes.
- Feature flag `USE_STRUCTURED_OUTPUT` controls thought generation method switch.

## 🎓 Lessons & Patterns

### Lesson: Collapsible side panel layout drift
**Problem:** Collapsing the note form caused the right tab to drop below the notes grid and arrows behaved inconsistently.  
**Wrong Paths:** Kept `lg:col-span-2` when grid changed; forgot to bind chevron rotation; icon sizes differed between states.  
**Root Cause:** Column span mismatch after layout change and missing state-driven icon rotation.  
**Correct Solution:** Sync grid spans (`lg:grid-cols-[1fr_auto]` with left `col-span-1` when collapsed), keep panels `items-stretch`, bind chevron rotation to `showForm`, unify icon sizes.  
**Best Practice:** Whenever adding collapsible columns, adjust both grid template and column spans together; tie icons to state; keep sizes consistent across states; re-check for duplicate renders after refactors.  
**Attention Points:** Verify vertical alignment and height parity when panels collapse; test chevron direction in both states.

### Lesson: Missing UX parity between inputs
**Problem:** Tag input lacked an explicit add action, forcing Enter-only and diverging from the scripture reference UX; users asked to mirror "Add place" behavior.  
**Wrong Paths:** Relied on implicit Enter handling; assumed datalist plus input was sufficient.  
**Root Cause:** Inconsistent interaction patterns across adjacent inputs in the same form.  
**Correct Solution:** Added controlled `tagInput` state and "Add tag" button with shared styling and Enter handler; resets input after add and dedupes tags.  
**Best Practice:** Keep sibling inputs (e.g., tags, references) aligned in interaction affordances and styling; always offer both keyboard and clickable triggers for add actions.  
**Attention Points:** Check for deduplication, state reset, and parity in hover/focus styles across similar controls.

### Lesson: Studies workspace localization consistency
**Problem:** The Studies workspace description and workspace strings diverged across locales and between `navigation.studies` and `studiesWorkspace`, making the feature feel different depending on language.  
**Wrong Paths:** Updated only the Russian description; left English/Ukrainian texts with the old "word studies" phrasing; did not sync the high-level nav description with the concrete workspace copy.  
**Root Cause:** Treated localization as a single-string change instead of a coordinated UX concept that spans multiple namespaces and languages.  
**Correct Solution:** Updated `navigation.studies.description` in all locales to the same functional concept (Bible notes workspace found by books/chapters/themes) and ensured `studiesWorkspace` keys describe the same mental model.  
**Best Practice:** When adjusting product copy for a core concept, always: (1) identify all keys that express that concept (nav, workspace, tooltips), (2) update all supported locales together, and (3) keep functional meaning, not just wording, in sync.  
**Attention Points:** Before editing text, grep the key/phrase across `locales/`; when adding a new workspace, enforce symmetry between navigation description and in-workspace helper text in every language.

### Lesson: Structured Output vs XML Function Extraction
**Problem:** Legacy AI calls used ~200 lines of code for XML function definitions + JSON extraction with multiple fallback strategies (`<arguments>` tags, code blocks, regex). Fragile and hard to maintain.  
**Wrong Paths:** Continuing to add more fallback parsing logic; assuming Gemini doesn't support structured output.  
**Root Cause:** Historical approach built before OpenAI/Gemini added native structured output support with `response_format` and Zod schemas.  
**Correct Solution:** Use `zodResponseFormat()` + `beta.chat.completions.parse()` which guarantees typed JSON responses. Created modular architecture:
- `config/schemas/zod/*.zod.ts` — Zod schemas
- `api/clients/structuredOutput.ts` — reusable utility
- `api/clients/*.structured.ts` — domain-specific functions  
**Best Practice:** For new AI features, always use structured output with Zod. Eliminates parsing code, provides type safety, automatic validation.  
**Attention Points:** Gemini 2.0 Flash supports structured output via OpenAI-compatible SDK. Feature flags (`USE_STRUCTURED_OUTPUT`) allow gradual migration.

### Lesson: Scripture Reference toVerse Cleanup
**Problem:** AI returned `{ fromVerse: 1, toVerse: 1 }` for single verses, displaying as "Joel 2:1-1" instead of "Joel 2:1".  
**Wrong Paths:** Trying to fix in AI prompt (unreliable); ignoring UX issue.  
**Root Cause:** Structured output schema allowed `toVerse` regardless of whether it equals `fromVerse`.  
**Correct Solution:** Post-process AI response in validation: if `toVerse === fromVerse`, remove `toVerse` from the object.  
**Best Practice:** Always validate/normalize AI structured output before using. Even with schema constraints, AI may return semantically redundant data.  
**Attention Points:** Check for edge cases like `toVerse < fromVerse` (invalid range) and `toVerse === fromVerse` (single verse, no range needed).

### Lesson: Multilingual AI Output with Fixed Schema Fields
**Problem:** Study notes can be in Russian/Ukrainian/English; AI must return title/tags in same language, but Scripture book names must ALWAYS be in English for storage compatibility.  
**Wrong Paths:** Assuming AI will infer language rules; not detecting input language.  
**Root Cause:** Mixed language requirements need explicit prompt engineering.  
**Correct Solution:** Detect Cyrillic via `/[\u0400-\u04FF]/` regex. Build language-specific prompt directives: "Title and tags in note's language, Scripture books ALWAYS in English (Matthew, not Матфей)".  
**Best Practice:** When AI output has mixed language requirements, (1) detect input language, (2) explicitly state per-field language rules in prompt, (3) include examples.  
**Attention Points:** ScriptureReference.book must be English for `referenceParser.ts` compatibility; test with all supported locales (en/ru/uk).
