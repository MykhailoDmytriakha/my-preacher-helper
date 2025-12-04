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

## 📝 Short-Term Memory
- Current session: widened open layout to ~60/40 (`lg:grid-cols-[1.6fr_1fr]`); added explicit "Add tag" button tied to controlled tag input.
- No pending known issues after layout width and tag button updates.

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
