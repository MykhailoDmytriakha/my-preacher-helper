when: TipTap · tiptap-markdown · @tiptap/react · @tiptap/markdown · RichMarkdownEditor · RichMarkdownToolbar · which rich text editor · add rich text to a feature · WYSIWYG markdown · toolbar does not follow the cursor · toolbar buttons frozen · useEditorState · shouldRerenderOnTransaction · NodeView · ReactNodeViewRenderer · custom inline node · atom chip · wikilink · markdown round-trip loses a node · parse.setup · markdown-it rule · link mark eats the anchor · Decoration.node · node decoration not applied · insert at cursor · setContent · emitUpdate · node ids lost after reload · paste markdown shows raw characters · Novel · редактор текста · форматированный текст · расширить редактор · панель инструментов не обновляется · свой узел в редакторе · вики-ссылка · узел пропал после перезагрузки · вставка Markdown показывает символы · вставить в позицию курсора

# Extend the rich text editor

All rich text goes through one editor: `RichMarkdownEditor` (`frontend/app/components/ui/RichMarkdownEditor.tsx`) — TipTap headless (`useEditor` + StarterKit) with `tiptap-markdown`, markdown being the stored form. Studies, thoughts, series, groups, councils and the plan already use it: extend it, never add a second editor or a "Notion clone" wrapper such as Novel.

## How

- Markdown in: `content`, and `editor.commands.setContent(draft, { emitUpdate: false })` when the value changes from outside. Markdown out: `editor.storage.markdown.getMarkdown()` in `onUpdate`. Keep `emitUpdate: false`: in TipTap 3 `setContent` fires `onUpdate` by default, which sends a remote snapshot back as the person's edit.
- The draft between keystroke and echo is `useBufferedText` (`frontend/app/components/ui/useBufferedText.ts`).
- Pasted markdown: `Markdown.configure({ transformPastedText: true })` handles plain-text clipboards; `MarkdownSourcePaste` (`frontend/app/utils/markdownPaste.ts`) handles markdown copied together with a `text/html` flavour (a chat code block), which ProseMirror would otherwise paste as raw characters.
- Toolbar state that follows the caret: `useEditorState({ editor, selector })`, as in `RichMarkdownToolbar.tsx`. `useEditor` in `@tiptap/react` v3 does not re-render React on transactions (`shouldRerenderOnTransaction` defaults to false), so an `editor.isActive(...)` read during render freezes after the first render. Do not re-render the whole editor instead.
- New markdown work: the installed `tiptap-markdown` 0.9 README says it will not be developed further and points to Tiptap's own markdown support. Evaluate the official `@tiptap/markdown` first, especially when you need custom tokenizers.

## Custom content — techniques

Main has no custom node, NodeView or decoration yet. Worked examples sit on unmerged branches: `feature/studies-wikilinks-v0` (frontend/app/components/studies/node/wikilinkExtension.ts and WikilinkChip.tsx) and `main-2` (RichMarkdownEditor with a pending insertion request and outline decorations). Read them with `git show <branch>:<path>`.

- Inline atom stored as markdown (`[[id]]`): `tiptap-markdown` renders markdown to HTML with markdown-it, then TipTap parses that HTML through the schema. Register a markdown-it inline rule in the node's `storage.markdown.parse.setup` that emits temporary HTML your `parseHTML` rule recognises; give the node and that rule a high `priority` and empty content; write it back in `storage.markdown.serialize`. Otherwise StarterKit's link mark takes the anchor before the node exists and the round-trip breaks.
- A chip whose label comes from an async cache: call the resolver hook inside the React NodeView (`ReactNodeViewRenderer`), not in the parent editor. Only chips subscribe; a subscription in the parent breaks unrelated editor tests and forces providers where no chip exists.
- Insert at the live cursor: do not splice the markdown string in page state. Send the editor a tokenized pending command (request + "consumed" callback) and let it insert at its own current selection.
- Node ids are session-only: persistence is markdown and the editor is rebuilt by `setContent(markdown)`, so any attribute markdown does not serialize is gone. Not an identity across sessions unless serialization writes it back.
- `Decoration.node(from, to, attrs)`: `from`/`to` are the node's outer boundaries — `offset` to `offset + node.nodeSize` from `doc.forEach`. Shifted inward, the class is silently not applied.

## Why

- 2026-02-25: TipTap headless + `tiptap-markdown` chosen for WYSIWYG over raw markdown storage; 2026-02-28: studies and notes reuse the thoughts editor so there is one editing experience.
- 2026-03-10: the toolbar froze after the first render; the same day a node decoration shifted inward did nothing.
- 2026-03-12: cursor insertion and node ids, both on `main-2`; 2026-05-20: wikilink atoms and chip subscriptions on `feature/studies-wikilinks-v0`.
