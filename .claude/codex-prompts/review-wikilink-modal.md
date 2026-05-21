Perform a senior-engineer code review at **xhigh effort** on the currently-staged changes in this repo.

## Scope
Repo: `/Users/mykhailo/MyProjects/my-preacher-helper`. Full staged diff (~2041 lines) is at `/tmp/code-review-diff.patch`. Files include:

- `frontend/app/components/studies/node/NodeView.tsx` (major refactor — textarea → tiptap)
- `frontend/app/components/studies/node/NodeTextEditor.tsx` (new — wraps RichMarkdownEditor with wikilink picker)
- `frontend/app/components/studies/node/NodeTreeEditor.tsx` (rootContent lift, includeRoot:false, wikilink resolver wiring, click-outside)
- `frontend/app/components/studies/node/useNodeTree.ts` (new `liftRootContent` action)
- `frontend/app/components/studies/node/wikilinkExtension.ts` (new tiptap inline atom + nodeInputRule + markdown serializer + markdown-it parse hook)
- `frontend/app/components/MarkdownDisplay.tsx` (wikilinkResolver prop, chip class change, `data-wikilink-id` attribute)
- `frontend/app/components/ui/RichMarkdownEditor.tsx` (new `extraExtensions`, `onPastePlainText`, `onBlur`, `hideToolbar`, `onEditorReady` props)
- `frontend/app/hooks/useWikilinkResolver.ts` (new hook)
- `frontend/app/(pages)/(private)/studies/[id]/page.tsx` (autosave signature-ref guard)
- `frontend/app/(pages)/(private)/studies/components/NotePreviewModal.tsx` (new modal)
- `frontend/app/(pages)/(private)/studies/components/NotePreviewProvider.tsx` (new context + global click delegator capture-phase)
- `frontend/app/(pages)/(private)/studies/layout.tsx` (new — mounts provider)
- `CLAUDE.md` (meta-rules)
- 3 locale files (one key each)

## What to look for

1. **Correctness bugs** — race conditions, stale closures, off-by-one in wikilink range, autosave signature gaps, markdown round-trip data loss, focus traps, leaked listeners.
2. **Code reuse** — anything I reimplemented that already exists in the codebase? (search utility/helper dirs, existing modal patterns, existing context providers).
3. **Quality** — redundant state, copy-paste with variation, leaky abstractions, stringly-typed where enum exists, dead code, unnecessary comments narrating what the code does.
4. **Efficiency** — N+1 in wikilink resolver Map building (3438 notes possible), document listeners not torn down, repeated JSON.stringify in autosave signature on every render (memo deps include arrays/objects that may not be referentially stable).
5. **Architecture** — does the click-delegator + provider pattern hold up? Is `extraExtensions` the right shape for RichMarkdownEditor extension? Should `liftRootContent` be in reducer vs side-effect? Tiptap markdown-it inline rule positioning (before/at `link`) — robust?
6. **A11y** — modal keyboard trap (currently only Esc; no focus restoration to chip on close), `aria-modal` correct, dialog role properly labelled.
7. **Test coverage gaps** — what's NOT covered that should be (capture-phase click, NotePreviewProvider mount/unmount, signature-ref autosave behavior, tiptap roundtrip with multiple wikilinks).

Be specific: cite file:line, quote the offending snippet, propose a concrete fix. **Do not apply any fixes** — just report. Output as a numbered list, P0/P1/P2 severity. Plain text, terse. Skip lint/style nits unless they hint at deeper issues.
