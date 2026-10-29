when: TipTap · tiptap-markdown · @tiptap/react · @tiptap/markdown · RichMarkdownEditor · RichMarkdownToolbar · which rich text editor · add rich text to a feature · WYSIWYG markdown · toolbar does not follow the cursor · toolbar buttons frozen · useEditorState · shouldRerenderOnTransaction · NodeView · ReactNodeViewRenderer · custom inline node · atom chip · wikilink · markdown round-trip loses a node · parse.setup · markdown-it rule · link mark eats the anchor · Decoration.node · node decoration not applied · insert at cursor · setContent · emitUpdate · setEditable · editable · read-only editor · restored text wiped · node ids lost after reload · paste markdown shows raw characters · Novel · редактор текста · форматированный текст · расширить редактор · панель инструментов не обновляется · свой узел в редакторе · вики-ссылка · узел пропал после перезагрузки · вставка Markdown показывает символы · вставить в позицию курсора · MarkdownDisplay · PlanMarkdown · PlanSectionDialog · raw HTML shows as tags · footnote link does not find target · duplicate footnote ids · cross-section definitions · подчёркивание показано тегом · сноска не открывается

# Extend the rich text editor

All rich text goes through one editor: `RichMarkdownEditor` (`frontend/app/components/ui/RichMarkdownEditor.tsx`) — TipTap headless (`useEditor` + StarterKit) with `tiptap-markdown`, markdown being the stored form. Studies, thoughts, series, groups, councils and the plan already use it: extend it, never add a second editor or a "Notion clone" wrapper such as Novel.

## How

- Markdown in: `content`, and `editor.commands.setContent(draft, { emitUpdate: false })` when the value changes from outside. Markdown out: `editor.storage.markdown.getMarkdown()` in `onUpdate`. Keep `emitUpdate: false`: in TipTap 3 `setContent` fires `onUpdate` by default, which sends a remote snapshot back as the person's edit.
- Holding the text still: `RichMarkdownEditor` takes `editable` and calls `editor.setEditable(editable, false)`. The second argument matters for the same reason: `setEditable` emits `update` by default (`@tiptap/core/src/Editor.ts:284`), and `onUpdate` then sends the words still drawn back as an edit — a draft restored at the moment the editor was released was wiped to empty live (2026-10-28). The toolbar gets the same word as an explicit `disabled`: `useEditorState` listens to transactions, and making an editor read-only is not one.
- The draft between keystroke and echo is `useBufferedText` (`frontend/app/components/ui/useBufferedText.ts`).
- Pasted markdown: `Markdown.configure({ transformPastedText: true })` handles plain-text clipboards; `MarkdownSourcePaste` (`frontend/app/utils/markdownPaste.ts`) handles markdown copied together with a `text/html` flavour (a chat code block), which ProseMirror would otherwise paste as raw characters.
- Toolbar state that follows the caret: `useEditorState({ editor, selector })`, as in `RichMarkdownToolbar.tsx`. `useEditor` in `@tiptap/react` v3 does not re-render React on transactions (`shouldRerenderOnTransaction` defaults to false), so an `editor.isActive(...)` read during render freezes after the first render. Do not re-render the whole editor instead.
- New markdown work: the installed `tiptap-markdown` 0.9 README says it will not be developed further and points to Tiptap's own markdown support. Evaluate the official `@tiptap/markdown` first, especially when you need custom tokenizers.

## Caret below sticky controls

- The opt-in `stickyToolbarTop` path uses `ui/useStickyEditorViewport.ts`: measure the existing toolbar, then pass its covered top edge into ProseMirror's native `scrollThreshold` and `scrollMargin`. The caller still owns the measured page/header offset. Keep the native other-edge defaults and ordinary manual scrolling; do not add a scroll loop or move the toolbar into a short wrapper that changes sticky containment.
- TipTap `Editor.setOptions` forwards `editorProps` into ProseMirror `setProps`, which merges keys. Omitting a formerly set scroll property does not clear it: provide explicit `undefined` on opt-out. Exercise enabling, toolbar/header resize, passive scroll retention and disabling on the same editor instance.
- Regression: `frontend/__tests__/components/ui/RichMarkdownEditor.scroll.test.tsx` runs the real editor/native algorithm with declared virtual geometry because JSDOM has no layout. Its DOMRect-shaped object avoids relying on a missing global constructor. Real compiled-browser typing and hit testing remain necessary for painted visibility.
- Browser keyboard fixtures must use the platform's intended action. On macOS, End scrolls the document without moving the insertion point; use Meta+ArrowDown to move the insertion point to the document end. A concurrent native navigation animation is a different scenario from ordinary continued typing. Retain strict geometry and original PNGs, and use native-bound disabling/restoring plus real wheel/keys to establish causality independently of that shortcut.

## Custom content — techniques

The shared factory owns the custom code, list and table nodes. Further NodeView and decoration examples sit on unmerged branches: `feature/studies-wikilinks-v0` (frontend/app/components/studies/node/wikilinkExtension.ts and WikilinkChip.tsx) and `main-2` (RichMarkdownEditor with a pending insertion request and outline decorations). Read them with `git show <branch>:<path>`.

- Inline atom stored as markdown (`[[id]]`): `tiptap-markdown` renders markdown to HTML with markdown-it, then TipTap parses that HTML through the schema. Register a markdown-it inline rule in the node's `storage.markdown.parse.setup` that emits temporary HTML your `parseHTML` rule recognises; give the node and that rule a high `priority` and empty content; write it back in `storage.markdown.serialize`. Otherwise StarterKit's link mark takes the anchor before the node exists and the round-trip breaks.
- A chip whose label comes from an async cache: call the resolver hook inside the React NodeView (`ReactNodeViewRenderer`), not in the parent editor. Only chips subscribe; a subscription in the parent breaks unrelated editor tests and forces providers where no chip exists.
- Insert at the live cursor: do not splice the markdown string in page state. Send the editor a tokenized pending command (request + "consumed" callback) and let it insert at its own current selection.
- Node ids are session-only: persistence is markdown and the editor is rebuilt by `setContent(markdown)`, so any attribute markdown does not serialize is gone. Not an identity across sessions unless serialization writes it back.
- `Decoration.node(from, to, attrs)`: `from`/`to` are the node's outer boundaries — `offset` to `offset + node.nodeSize` from `doc.forEach`. Shifted inward, the class is silently not applied.

## Why

- 2026-02-25: TipTap headless + `tiptap-markdown` chosen for WYSIWYG over raw markdown storage; 2026-02-28: studies and notes reuse the thoughts editor so there is one editing experience.
- 2026-03-10: the toolbar froze after the first render; the same day a node decoration shifted inward did nothing.
- 2026-03-12: cursor insertion and node ids, both on `main-2`; 2026-05-20: wikilink atoms and chip subscriptions on `feature/studies-wikilinks-v0`.

## Block-first list items and saved Markdown

`MarkdownListItem` keeps the native `paragraph block*` list schema and commands.
Markdown may begin a list item with code, a quote, a heading, a nested list or a
rule. Its Markdown `parse.updateDOM` supplies the required paragraph before normal
schema parsing. Derive block selectors from the active schema; do not reparse the
item's children through an isolated `getContent` callback: that loses marks
inherited from list ancestors in native rich HTML.

During serialization, skip only the empty leading paragraph before a nonparagraph
block. Start the real block on the marker line. A blank marker plus an extra blank
line ends the item; a bare nested dash can become a Setext heading. Write a first
horizontal rule with underscores, since `- ---` is an outside thematic break.

Test structure before comparing round trips: equality alone passes when both
copies already lost the list boundary. Check initial Markdown, repeated saves,
plain and HTML-source clipboards, and native HTML paste separately. Native
`EditorView.pasteHTML` uses contextual slice fitting and can already supply the
paragraph; keep its normal mark context. In jsdom pass an explicit paste Event
when ClipboardEvent is unavailable. Compare inherited bold/italic/strike with the
native ListItem parser and retain indent/outdent/split controls.

Already flattened stored Markdown cannot safely be reattached by a regex: an
intended outside block is indistinguishable. Keep the native editable paragraph;
hiding it would remove a place where the person can type an introduction.

## Tables in existing content and paste

`richMarkdownExtensions` registers `TableKit` with its table disabled and adds
`MarkdownTable` once. The kit owns rows, cells, headers and native table commands;
`markdownTable.ts` owns the persistence representation. Keep this in the shared
factory so notes, comments, thoughts, plans, groups, series and councils agree.

Write ordinary single-paragraph header/body tables as GFM. Use the canonical
schema HTML serializer for cell spans, multiple/block paragraphs, hard breaks,
column widths or a literal pipe anywhere in content/mark attributes. A pipe inside
inline code or a link target can still split a GFM table; escaping only text nodes
misses it. The reader already supports sanitized HTML tables. Do not recover
historically flattened data by guessing where its cells used to be.

For normal text-only paste, dispatch a DOM paste event or call the clipboard
parser with plainText=false. ProseMirror `view.pasteText` requests the deliberate
paste-as-plain-text escape hatch; its literal result is a separate positive
control. Test rich HTML, plain Markdown and Markdown-source-with-HTML clipboards,
edit/save/reopen, repeated saves and table ancestry inside quotes/lists. Retain
ordinary prose, list, code and read-only editor controls. Browser geometry,
keyboard editing, real save ACKs and visual acceptance remain separate evidence.

## Read the editor’s saved HTML consistently

The shared editor can persist HTML for formatting that Markdown cannot represent, including underline and canonical rich tables. Render that stored form through `utils/markdownHtml.ts` and `hooks/useMarkdownHtmlPlugins.ts`: parse raw HTML, apply the existing safe allow-list, then reconnect actual fragment/ARIA targets inside this reading card. `MarkdownDisplay`, `PlanMarkdown`, `PlanSectionDialog` and the Markdown-mode `ExportTxtModal` share this pass; feature grouping and ScriptureLinks run afterward. Keep literal code literal and preserve external URLs.

Never disable the sanitizer’s clobber protection to repair footnotes. Every id/name retains the `user-content-` namespace and a stable per-mounted-reader React scope; href/ARIA references follow only targets in that same tree. Two cards using the same footnote label must remain independent. The existing `MarkdownDisplay` schema export is a compatibility re-export, not a second rule. Local fragment links stay in their current page; external note links retain their separate-window policy. Tests: `planRichHtml.rendered.test.tsx`, `planHierarchy.test.tsx`, and `ScriptureLinks.rendered.test.tsx`. Browser acceptance must also use the real compiled reader. TXT/plain-copy conversion has a different owner in `planHierarchy`; HTML rendering is not a fix for its literal-tag export.

This pass reconnects only targets present in one parsed tree. Resolve document-wide link/footnote definitions before a feature splits Markdown into independently parsed sections; the HTML pass cannot reconstruct a definition that parsing never received. `FoldableMarkdown` has a separately tracked cross-section definition gap.


## Plain plan TXT projection

`utils/markdownPlainText.ts` parses the complete GFM document, converts it through the same raw-HTML/sanitizer pass, and projects readable blocks. Resolve link and footnote definitions before splitting or projecting. Inline marks lose only their formatting; literal code and link display text bypass prose transforms. Tables use tab-separated cells and line-separated rows; flow containers must preserve whitespace between inline marks and distinguish adjacent paragraph children inside cells.

`utils/planHierarchy.ts` owns plan heading/body indentation and prose-arrow normalization. Source-line `blankBefore` metadata preserves an adjacent paragraph/list newline, while headings keep their explicit section spacing. Do not run source-wide sanitization, entity decoding or arrow replacement over code or URLs. TXT modal preview, Copy and Download consume the same prepared string; Markdown export retains the authored source. Keep raw/sanitize plugins real in Jest because the pure serializer executes them too. `remark-rehype` is an explicit dependency at the existing locked reader version.

Regression coverage: `__tests__/utils/planPlainText.test.ts`, `__tests__/utils/exportContentRenderer.test.ts`, `__tests__/utils/exportContent.test.ts`, and `__tests__/pages/planHierarchy.test.tsx`. Browser acceptance opens the actual TXT modal in both plan routes and checks native downloaded bytes against its preview, plus unchanged Markdown. Use owned download directories and emulator-only data; do not overwrite the owner's clipboard or Downloads folder.


The export modal calls `useMarkdownHtmlPlugins` before its closed-state return, so opening, closing and changing preview content keep Hooks order and per-card scope stable. Its plain mode still displays the prepared TXT string, while Markdown mode renders the prepared source; Copy/Download always use that source value, never the preview DOM. Tests: `ExportTxtModal.richPreview.test.tsx` plus existing modal/preview contracts. Keep the separate source-wide normalization-over-code tracker item distinct: adding HTML parsing does not make earlier string preprocessing code-safe.
