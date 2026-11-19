import { Editor } from '@tiptap/core';

import { richMarkdownExtensions } from '@/components/ui/richMarkdownExtensions';

it('reads live Markdown and registers synchronously before the view can expose a document', () => {
  jest.useFakeTimers();
  const live = '**Arrival**\n\nKept';
  const events: string[] = [];
  let registered: Editor | undefined;
  const editor = new Editor({
    extensions: richMarkdownExtensions(),
    content: 'Stale render',
    onBeforeCreate: ({ editor }) => {
      // The extension has already installed its parser, but no document/view exists yet.
      const markdown = editor.storage as unknown as { markdown: { parser: { parse: (value: string) => string } } };
      editor.options.content = markdown.markdown.parser.parse(live);
      registered = editor;
      events.push('beforeCreate');
    },
    onMount: ({ editor }) => {
      expect(registered).toBe(editor);
      expect(editor.state.doc.textContent).toBe('ArrivalKept');
      events.push('mount');
    },
    onCreate: () => events.push('create'),
  });
  expect(events).toEqual(['beforeCreate', 'mount']);
  expect(editor.view.dom.textContent).toBe('ArrivalKept');
  jest.advanceTimersByTime(0);
  expect(events).toEqual(['beforeCreate', 'mount', 'create']);
  editor.destroy();
  jest.useRealTimers();
});
