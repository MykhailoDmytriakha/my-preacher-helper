import Placeholder from '@tiptap/extension-placeholder';
import { EditorContent, useEditor } from '@tiptap/react';
import React, { useEffect } from 'react';

import { richMarkdownExtensions } from '@/components/ui/richMarkdownExtensions';
import { useBufferedText } from '@/components/ui/useBufferedText';

/** Production c6cf18ca's value bridge, kept as an independent oracle for selection/composition. */
export function ProductionSetContentReference({ value, editable = true }: { value: string; editable?: boolean }) {
  const { draft, change } = useBufferedText(value, () => undefined);
  const editor = useEditor({
    extensions: [...richMarkdownExtensions(), Placeholder.configure({ placeholder: '' })],
    content: value, editable, immediatelyRender: false, autofocus: false,
    onUpdate: ({ editor: updated }) => {
      change((updated.storage as unknown as { markdown: { getMarkdown: () => string } }).markdown.getMarkdown());
    },
  });
  useEffect(() => {
    const current = editor ? (editor.storage as unknown as { markdown: { getMarkdown: () => string } }).markdown.getMarkdown() : '';
    if (editor && draft !== current) editor.commands.setContent(draft, { emitUpdate: false });
  }, [draft, editor]);
  useEffect(() => {
    if (editor && editor.isEditable !== editable) editor.setEditable(editable, false);
  }, [editor, editable]);
  return <EditorContent editor={editor} />;
}
