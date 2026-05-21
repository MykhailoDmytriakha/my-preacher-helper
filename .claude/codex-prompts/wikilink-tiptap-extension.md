Implement a tiptap Node extension that renders `[[noteId]]` wikilink tokens as inline chips inside the editor, matching how MarkdownDisplay already renders them in read mode.

## Repo
`/Users/mykhailo/MyProjects/my-preacher-helper/frontend` (Next.js 14 App Router, TypeScript, Tailwind, tiptap v2 + tiptap-markdown).

## Context — already in place
- `app/components/MarkdownDisplay.tsx` — read-mode renderer. `[[id]]` → `[🔗 ${title || id}](/studies/${id})` via `transformWikiLinks`, then ReactMarkdown renders `a` as styled chip (`bg-indigo-50 text-indigo-700 rounded-md px-1.5`).
- `app/hooks/useWikilinkResolver.ts` — returns `(id) => string | undefined` built from `useStudyNotes()` cache.
- `app/components/ui/RichMarkdownEditor.tsx` — tiptap-based editor using StarterKit + tiptap-markdown + Placeholder. Accepts optional `onEditorReady(editor)` callback.
- `app/components/studies/node/NodeTextEditor.tsx` — thin wrapper around RichMarkdownEditor that adds wikilink picker (`[[` trigger → existing WikilinkPicker). Uses `onEditorReady` to get the editor instance.

## What to build
1. **New extension file** `app/components/studies/node/wikilinkExtension.ts` exporting a tiptap `Node` extension named `wikilink`:
   - Inline atom node with one attribute `id: string`.
   - `parseHTML`: matches `a[data-wikilink-id]`.
   - `renderHTML`: `<a class="inline-flex items-center rounded-md bg-indigo-50 px-1.5 py-0.5 text-indigo-700 hover:bg-indigo-100 dark:bg-indigo-900/40 dark:text-indigo-300 dark:hover:bg-indigo-900/60" data-wikilink-id={id} href="/studies/{id}" contenteditable="false">🔗 {resolvedTitle || id}</a>`.
   - `addOptions`: `{ resolver?: (id: string) => string | undefined }`. The resolver should be read at render time. Easiest: store on extension options, mutate via `editor.extensionManager.extensions.find(e => e.name === 'wikilink').options.resolver = …` from a useEffect in the wrapper.
   - `addInputRules`: when user types `]]` after `[[id`, replace the literal range with the wikilink node. Regex: `/\[\[([A-Za-z0-9_-]+)\]\]$/`. Use `nodeInputRule` from `@tiptap/core`.
   - Markdown round-trip: register a markdown serializer via `tiptap-markdown`. Check `node_modules/tiptap-markdown` for serializer API. Define a `serialize` function returning literal `[[id]]` text.
   - Parsing from markdown: on `setContent` from raw markdown, the markdown extension converts text → doc nodes. Ensure literal `[[id]]` becomes a `wikilink` node — either via input rules (works while typing but not on initial setContent), or by intercepting the markdown parse pipeline. If parse-pipeline interception is too invasive, simpler: on every external `setContent`, run a doc traversal that finds text nodes matching the pattern and replaces them with wikilink nodes. Document the approach in code.

2. **Integrate** in `NodeTextEditor.tsx`:
   - Import the new extension, add to the `useEditor` extensions list. Since RichMarkdownEditor owns useEditor — option A: pass the extension to RichMarkdownEditor via a new `extraExtensions?: Extension[]` prop; option B: NodeTextEditor stops wrapping RichMarkdownEditor and owns its own useEditor with all extensions. **Prefer option A** to keep RichMarkdownEditor as the single source of editor config.
   - Wire the resolver from `useWikilinkResolver()` into the extension options on mount/update.

3. **Tests**: extend `app/components/studies/node/__tests__/NodeView.test.tsx` or add a new test that mounts NodeTextEditor with a fake resolver and verifies that `[[abc]]` in initial value renders as a chip with the resolved title.

## Constraints
- Strict TS, no `any` unless absolutely necessary (use `@ts-expect-error` with a comment matching the style of existing `tiptap-markdown` casts in RichMarkdownEditor).
- Don't break existing 51 tests in `app/components/studies/node/__tests__/`.
- Don't change MarkdownDisplay (read mode is already correct).
- Markdown round-trip is the critical bit: when the user types/inserts `[[id]]` and the editor's `onUpdate` callback runs, the markdown that flows out (via `editor.storage.markdown.getMarkdown()`) MUST still be `[[id]]` — otherwise dual-write to server will corrupt the data.

## Deliverables
- New file `wikilinkExtension.ts`.
- Updated `RichMarkdownEditor.tsx` (added `extraExtensions?` prop).
- Updated `NodeTextEditor.tsx` (uses the extension, wires resolver).
- Test coverage as described.
- All of `npx tsc --noEmit` and `npx jest app/components/studies/node` must pass.

## Helpful files to read first
- `app/components/studies/node/NodeTextEditor.tsx`
- `app/components/ui/RichMarkdownEditor.tsx`
- `app/components/MarkdownDisplay.tsx` (just to mirror the chip styles)
- `app/hooks/useWikilinkResolver.ts`
- `node_modules/tiptap-markdown/dist/` (for serializer API)
- `node_modules/@tiptap/core/dist/` (for nodeInputRule, Node.create types)

Work entirely inside `frontend/`. No commits — just leave the patch on disk.
