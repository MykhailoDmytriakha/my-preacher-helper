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

- The current code does not follow the fence rule: `splitMarkdownSections` flips on any line starting with three backticks or three tildes. Probe 2026-09-27: a four-backtick fence quoting a three-backtick block with `# Inside code` returns that heading as a section; a tilde fence holding a backtick line closes early and swallows the real heading after it. The same naive flip lives in `normalizePlanPointHeadings` (`frontend/app/utils/markdownUtils.ts`) and `collectNoteHeadings` (`frontend/app/api/studies/notes/[id]/cut/route.ts`), both backticks only. Fix all three with one fence tracker.

## Why

- 2026-03-11: headings inside long-fence code blocks were promoted into structure because the parser tracked the fence character only.

See also: `.howto/extend-tiptap-editor.md`
