when: show note markdown · render markdown with headings · heading hierarchy · indent sections · fold a section · collapse headings · chevron per heading · table of contents · FoldableMarkdown · splitMarkdownSections · markdownSections · MarkdownDisplay · useMarkdownOutline · jumpToSection · search hides text in a folded section · heading inside code fence · heading promoted from a code block · fenced code block · backtick fence · tilde fence · показать Markdown заметки · заголовки · свернуть раздел · оглавление · сворачиваемые разделы · иерархия заголовков · поиск в свёрнутом разделе · блок кода

# Show note markdown as a foldable outline

`splitMarkdownSections` (`frontend/app/utils/markdownSections.ts`) recovers the section tree the headings already describe, and `FoldableMarkdown` (`frontend/app/components/ui/FoldableMarkdown.tsx`) renders it. Presentation only: the stored markdown is never rewritten, so every existing note gets the outline without a migration.

## How

- Tree: a section nests under the nearest preceding section of a lower level, so skipped levels (`#` straight to `###`) still nest. Section ids are index paths such as `0.2.1` — stable within one parse only, not an identity across edits.
- `FoldableMarkdown` draws a chevron per heading and a guide line per level. One whole-document `MarkdownDisplay` resolves links/footnotes, then the trusted `markdownFolding` HAST presentation groups blocks into the existing tree. A note with no headings falls back to plain `MarkdownDisplay`, unchanged.
- Search: pass `searchQuery`; a section holding a hit is force-opened with its ancestors (`findSectionIdsMatching`), so a folded section never hides a match.
- The note page draws the tree twice (side panel and text). Both share one fold state: `useMarkdownOutline` (`frontend/app/hooks/useMarkdownOutline.ts`) passed as `control`. Jump with `jumpToSection` — it opens the ancestors first, then scrolls.
- Plain-text uses (aria labels, outline rows) take `headingText` from `markdownPlainText.markdownHeadingText`: the safe reader removes prose formatting but preserves literal code. Links contribute their label without an appended URL. The reading presentation keeps the whole authored document; `headingMarkdown` remains the complete raw heading block (including Setext underlines or safe HTML) for boundary consumers such as Word.
- `markdownHeadings.markdownHeadingRanges` projects root heading nodes from `markdownHtml.readMarkdownHtml`, the existing safe whole-document reader. Outline, cutter, server grounding and Word share these original source ranges. ATX indentation, Setext, safe HTML and LF/CRLF/bare CR use one grammar; headings nested inside lists or quotes stay inside their containers.
- A `#` inside fenced code is code, not a heading. A fence closes only on the same marker (backticks or tildes) with a length at least the opener's. Tracking the marker character alone promotes headings out of a long fence that quotes a shorter one.

## Traps

- Read code boundaries with `markdownCodeLines(content)` / `withoutMarkdownCode(content, includeInline)` from `frontend/app/utils/markdownCode.ts`. They use the renderer's existing `unified` + `remark-parse` + `remark-gfm` parser, so long fences, quotes, list termination and indented code agree with the rendered note. Never add a separate container/fence regex.
- `withoutMarkdownCode` masks the original source ranges and keeps line endings/offsets. Previews keep inline-code text; measurements opt into excluding it. Heading consumers use `markdownHeadingRanges`, rather than a code line set plus a second heading regex.
- Keep `codeFenceFor` in the lightweight writer module `markdownFence.ts`; a serializer does not need to load the reader/parser.
- Parser packages are direct dependencies pinned to the installed renderer-compatible versions. Tests must use the real GFM plugin: an empty `remark-gfm` mock cannot be registered with `unified`.

## Why

- 2026-03-11: headings inside long-fence code blocks were promoted into structure because the parser tracked the fence character only.

See also: `.howto/extend-tiptap-editor.md`

## Structured prose and code have different containers

- `markdownStructuredBlocks` owns the five legacy structured types through `STRUCTURED_BLOCK_TYPES`; `MarkdownDisplay` consumes that list and its `prepareStructuredBlocks` output. The same classifier decides whether the generated code body is a callout and whether its code-only `pre` wrapper is removed. Keep these decisions together; a callout inside `pre` inherits code whitespace and can widen the page.
- Callouts preserve authored line breaks and wrap prose/long words. Real code keeps its `pre`/`code` container and its own horizontal scroll; do not globally reset code whitespace to repair prose.
- A matched search token has its own whitespace policy. `HighlightedText.wrapMatches` and the forwarding `ScriptureText.wrapSearchMatches` default to false for existing labels; structured prose opts in. The shared highlight component owns the actual style. Avoid a parent `!important` rule that reaches into its marks.
- Real-renderer Jest checks cover the semantic boundary and code bytes. Actual wrapping requires a browser measurement of page/callout widths, highlighted fragment rectangles, verse return/reload and preserved stored content at narrow and wide widths. A green jsdom style check is not layout evidence.
- CSS reference: [CSS Text Level3, overflow wrapping](https://www.w3.org/TR/css-text-3/#overflow-wrap-property); overflow wrapping takes effect when whitespace permits wrapping.

- A scrollable code box still needs a constrained flex parent. The Notes card navigation row keeps `min-w-0`; without it a real long code line in the collapsed preview can set the row's intrinsic width and stretch the whole page even though `pre` has its own scrollbar. Test collapsed search results as well as an expanded note.


## Preserve historical source-heading links

- `sectionHeadingLookup` in `markdownSections` is the shared placement/navigation owner. It reads current labels plus the exact former outline/cutter spellings derived from the original ATX heading block. These historical aliases are lookup-only; never render or write them as new canonical labels.
- `headingLookup.uniqueHeadingLookup` admits several aliases for one parse-local section id, but removes a key shared by distinct ids, including a current label colliding with another section's historical alias. Never prefer the first match or a current label over ambiguous history.
- `SourceNoteSection` groups an atom by the resolved section id. Missing or ambiguous sources stay once in the existing note-opening stack, with their text and stored provenance intact. Badges and jump use the same lookup.
- The cutter uses `splitNoteIntoSections` and indexes current labels plus original authored fragments with its existing case/whitespace normalization. New source headings contain only the current reader label. Unknown or ambiguous model headings leave the location empty; claims remain available.
- Section ids are stable within a parse only. This lookup is not a stored-identity migration and cannot reconstruct a location that historical data never distinguished.
- Root heading boundaries are owned by `markdownHeadingRanges`; historical regexes in lookup code derive old aliases only and never detect a boundary. Reference definitions across folded section boundaries remain a separate concern.
- Preserve source byte offsets and meaningful indentation/line endings. `preserveBodyWhitespace` keeps body bytes while one line delimiter is owned by the next heading; a heading source block excludes its following newline. Never normalize or decode source text to infer offsets.
- An empty real heading still creates a section. `sectionDisplayLabel` supplies a translated navigation/active-title/fold-control caption only; the authored reading heading and stored content remain empty.
- At a route boundary, test emptiness with `content.trim()` but pass the original `content` to the parser/model. Global trim before parsing promotes leading indented code into headings.

## Legacy callout preparation and original boundaries

- `prepareStructuredBlocks` converts `[Quote: ...]` and its four supported peers only when the opener is in the existing `markdownSource.markdownProseSourceRanges` and has no odd backslash escape. Code, link labels/destinations and raw HTML attributes remain literal. Do not add a second code/link classifier or apply a whole-string replacement in a component.
- `markdownHeadingRanges` parses the same prepared document, then maps unchanged positions back to original UTF-16 source offsets. Generated replacement interiors have no source heading position. Never accumulate an absolute offset difference a second time.
- A multiline callout owns its internal hash lines; the outline, cutter, server grounding and Word inherit this ownership through the common heading projection. Word retains its existing raw callout-body contract.
- A callout written within an ATX heading becomes body content after the visible heading prefix. Its original raw spelling remains a lookup-only historical alias for that original heading start; ambiguous aliases resolve nowhere. Stored source and source-note provenance are never rewritten.

## Keep document-wide definitions while sections fold

- Use one whole-document `MarkdownDisplay` for a folded note. Appending definitions to each fragment creates duplicate footnotes and independent target namespaces; a parent wrapper around several readers does not resolve this.
- The trusted `presentation` extension runs after the same safe HTML pipeline. `markdownFolding` reuses the canonical HAST heading predicate and groups already-resolved blocks; raw authored tags do not gain permission to become presentation components.
- Generated, unpositioned `section[data-footnotes]` stays at the document root. An authored similarly named HTML section retains its original section owner. A count/level mismatch with an external outline falls back to complete resolved content; the caller still owns providing the matching document control.
- `FoldingPresentation` uses stable component types and Context; the presentation object is memoized. Fold-only state updates preserve the existing parsed tree and host-owned editors in other sections. Test both editor value and DOM identity, not just text after a render.
- `markdownProseClasses` remains owned by MarkdownDisplay. Heading/body/intro/footer content opts into those exact classes, while controls and source extras keep their existing frame. Whitespace-only content has no prose wrapper, so a first child section retains its existing first-child spacing.
- The HAST pass annotates links only to actual, scoped targets in this reader. If a target is unmounted behind a fold, reveal its section and ancestors, then perform the hash navigation after rendering. A previously nonfocusable target can receive a temporary tabindex for focus, removed on blur; authored tabindex values remain intact. Never select a matching label or a target in another card.
- Test references in headings and bodies, forward/backward/repeated use, one footer, independent same-label documents, ordinary folding/shared controls, literal code/callouts and source extras. Browser acceptance includes an actual jump/back, reload, warmed-offline reading and the source-card consumer; jsdom alone does not prove layout or a native scroll.
