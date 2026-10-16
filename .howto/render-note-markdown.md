when: show note markdown · render markdown with headings · heading hierarchy · indent sections · fold a section · collapse headings · chevron per heading · table of contents · FoldableMarkdown · splitMarkdownSections · markdownSections · MarkdownDisplay · useMarkdownOutline · jumpToSection · search hides text in a folded section · heading inside code fence · heading promoted from a code block · fenced code block · backtick fence · tilde fence · показать Markdown заметки · заголовки · свернуть раздел · оглавление · сворачиваемые разделы · иерархия заголовков · поиск в свёрнутом разделе · блок кода

# Show note markdown as a foldable outline

`splitMarkdownSections` (`frontend/app/utils/markdownSections.ts`) recovers the section tree the headings already describe, and `FoldableMarkdown` (`frontend/app/components/ui/FoldableMarkdown.tsx`) renders it. Presentation only: the stored markdown is never rewritten, so every existing note gets the outline without a migration.

## How

- Tree: a section nests under the nearest preceding section of a lower level, so skipped levels (`#` straight to `###`) still nest. Section ids are index paths such as `0.2.1` — stable within one parse only, not an identity across edits.
- `FoldableMarkdown` draws a chevron per heading and a guide line per level, and renders text with `MarkdownDisplay`. A note with no headings falls back to plain `MarkdownDisplay`, unchanged.
- Search: pass `searchQuery`; a section holding a hit is force-opened with its ancestors (`findSectionIdsMatching`), so a folded section never hides a match.
- The note page draws the tree twice (side panel and text). Both share one fold state: `useMarkdownOutline` (`frontend/app/hooks/useMarkdownOutline.ts`) passed as `control`. Jump with `jumpToSection` — it opens the ancestors first, then scrolls.
- Plain-text uses (aria labels, outline rows) take `headingText`, inline markdown stripped; rendering takes `headingMarkdown`, the raw line.
- A `#` inside fenced code is code, not a heading. A fence closes only on the same marker (backticks or tildes) with a length at least the opener's. Tracking the marker character alone promotes headings out of a long fence that quotes a shorter one.

## Traps

- Read code boundaries with `markdownCodeLines(content)` / `withoutMarkdownCode(content, includeInline)` from `frontend/app/utils/markdownCode.ts`. They use the renderer's existing `unified` + `remark-parse` + `remark-gfm` parser, so long fences, quotes, list termination and indented code agree with the rendered note. Never add a separate container/fence regex.
- `withoutMarkdownCode` masks the original source ranges and keeps line endings/offsets. Previews keep inline-code text; measurements opt into excluding it. Heading scanners use the line set and leave the code bytes untouched.
- Keep `codeFenceFor` in the lightweight writer module `markdownFence.ts`; a serializer does not need to load the reader/parser.
- Parser packages are direct dependencies pinned to the installed renderer-compatible versions. Tests must use the real GFM plugin: an empty `remark-gfm` mock cannot be registered with `unified`.

## Why

- 2026-03-11: headings inside long-fence code blocks were promoted into structure because the parser tracked the fence character only.

See also: `.howto/extend-tiptap-editor.md`
