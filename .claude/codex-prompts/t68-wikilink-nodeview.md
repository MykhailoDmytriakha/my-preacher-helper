**T68 — Custom tiptap NodeView for wikilink chips (live re-render on cache hydration).**

Repo: `/Users/mykhailo/MyProjects/my-preacher-helper/frontend`. Tiptap v2 + tiptap-markdown + tiptap-react.

## Problem
`app/components/studies/node/wikilinkExtension.ts` currently uses static `renderHTML` for `[[noteId]]` atoms. Resolver title is read once at parse time; if `useWikilinkResolver` cache hydrates AFTER chip creation (common — notes list loads async), existing chips stay as raw ID. Static HTML can't re-render on resolver change.

## Fix
Replace static `renderHTML` chip with a **React NodeView** via `ReactNodeViewRenderer` from `@tiptap/react`. The React component reads the resolver via context, so resolver updates re-render automatically.

## Constraints
1. **Markdown round-trip MUST remain intact.** `editor.storage.markdown.getMarkdown()` must still produce `[[id]]` for serialized doc — the existing `addStorage.markdown.serialize` is fine, do not break it.
2. **Markdown-it `parse.setup` rule MUST remain** so initial `setContent('[[abc]]')` creates a wikilink node. Don't remove it.
3. **`nodeInputRule` MUST remain** so typing `]]` triggers conversion.
4. **Chip visuals MUST stay identical** to current — use `WIKILINK_CHIP_CLASS` and `WIKILINK_CHIP_GLYPH` from `app/components/studies/node/wikilinkConstants.ts`. Use Next.js `next/link` for the `<a>` so internal navigation still works (but global click delegator in `NotePreviewProvider` intercepts — keep `data-wikilink-id` attribute via `WIKILINK_DATA_ATTR`).
5. **Resolver delivery to NodeView component:** the cleanest path is React Context. Create `app/components/studies/node/WikilinkResolverContext.tsx` exporting a Provider + a `useWikilinkResolverContext()` hook. Wrap the editor's render tree with the provider in `NodeTextEditor.tsx` — pass current `wikilinkResolver` value. The NodeView component reads from context. When `wikilinkResolver` value changes (which it can — reference is stable now, but the underlying `titleByIdRef` updates), React re-renders the Provider, and consumers re-render automatically? **Wait** — since `useWikilinkResolver()` returns a stable callback (see `app/hooks/useWikilinkResolver.ts`), context value won't change. So you need a different trigger: pass `useStudyNotes().notes` array length or a derived signature into the Provider value, so context value changes when cache hydrates. Pick the simplest reliable trigger.

   Alternative: the NodeView component calls `useStudyNotes()` directly (subscribes to React Query) — every cache update re-renders all chips. Simpler. Use this if it works.

## Deliverables
- `app/components/studies/node/wikilinkExtension.ts` — replace static renderHTML with `ReactNodeViewRenderer`. Use `addNodeView({ ... })` returning the React component. Keep `parseHTML`, `addInputRules`, `addStorage` intact.
- `app/components/studies/node/WikilinkChip.tsx` (NEW) — React component for the chip. Reads resolver, renders `<a data-wikilink-id={id} href={STUDIES_LINK_PREFIX+id} class={WIKILINK_CHIP_CLASS}>{WIKILINK_CHIP_GLYPH} {title || id}</a>`. Use `NodeViewWrapper` from `@tiptap/react`. **Make wrapper an inline element** (`as="span"` if needed) — atom nodes are inline so the wrapper shouldn't add block layout.
- Update `app/components/studies/node/NodeTextEditor.tsx` if any wiring needed.
- Update test `app/components/studies/node/__tests__/NodeTextEditor.wikilink.test.tsx` if necessary — current assertions look for chip text via `findByRole('link')`; with a React NodeView the DOM should still emit the same anchor, so tests likely still pass. Verify.

## Acceptance
- `npx tsc --noEmit` passes.
- `npx jest app/components/studies/node` passes (53+ tests).
- Markdown round-trip: in a manual test, `editor.commands.setContent('text [[abc]] more')` → `editor.storage.markdown.getMarkdown()` returns `text [[abc]] more`.
- Resolver change re-renders chip: a test that mounts NodeTextEditor with one resolver, then updates the resolver and asserts chip text updates.

No commits. No fixes outside the listed files.
