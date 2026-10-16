import { ListItem } from '@tiptap/extension-list';

import type { Editor } from '@tiptap/core';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';

interface MarkdownListWriter {
  write(text: string): void;
  render(node: ProseMirrorNode, parent: ProseMirrorNode, index: number): void;
  renderContent(node: ProseMirrorNode): void;
  closeBlock(node: ProseMirrorNode): void;
}

/** Bridge CommonMark block-first items to the editor's required leading paragraph. */
export const MarkdownListItem = ListItem.extend({
  addStorage() {
    return {
      ...this.parent?.(),
      markdown: {
        parse: {
          updateDOM(this: { editor: Editor }, element: HTMLElement) {
            const blockSelector = Object.values(this.editor.schema.nodes)
              .filter(node => node.isBlock && node.name !== 'paragraph')
              .flatMap(node => node.spec.parseDOM?.map(rule => rule.tag) ?? [])
              .filter(Boolean)
              .join(',');
            if (!blockSelector) return;
            for (const item of element.querySelectorAll('li')) {
              const first = Array.from(item.childNodes).find(node => node.nodeType === 1
                || (node.nodeType === 3 && node.textContent?.trim()));
              if (first?.nodeType === 1 && (first as Element).matches(blockSelector)) {
                // Supply the required paragraph before normal parsing, keeping ancestor marks
                // in the same parser context instead of rebuilding the item in isolation.
                item.prepend(item.ownerDocument.createElement('p'));
              }
            }
          },
        },
        serialize(state: MarkdownListWriter, node: ProseMirrorNode) {
          const first = node.firstChild;
          const placeholder = node.childCount > 1 && first?.type.name === 'paragraph'
            && first.content.size === 0 && node.child(1).type.name !== 'paragraph';
          if (!placeholder) {
            state.renderContent(node);
            return;
          }
          // Put the first real block on the marker line: a bare nested '-' can otherwise
          // underline the preceding paragraph as a Setext heading.
          node.forEach((child, _offset, index) => {
            if (index === 0) return;
            if (index === 1 && child.type.name === 'horizontalRule') {
              // '- ---' is a thematic break outside a list. Underscores cannot merge with
              // any bullet marker, so the same rule remains inside its item.
              state.write('___');
              state.closeBlock(child);
            } else {
              state.render(child, node, index);
            }
          });
        },
      },
    };
  },
});
