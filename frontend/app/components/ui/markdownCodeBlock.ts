import CodeBlock from '@tiptap/extension-code-block';

import { codeFenceFor } from '@/utils/markdownFence';

import type { Node as ProseMirrorNode } from '@tiptap/pm/model';

/** The part of tiptap-markdown's serializer state a block writer uses. */
interface MarkdownWriter {
    write(text: string): void;
    text(text: string, escape?: boolean): void;
    closeBlock(node: ProseMirrorNode): void;
}

/** StarterKit's code block, written back to Markdown with a fence its content cannot close. */
export const MarkdownCodeBlock = CodeBlock.extend({
    addStorage() {
        return {
            ...this.parent?.(),
            // Merged over tiptap-markdown's own code block spec, which keeps parsing as it was.
            markdown: {
                serialize(state: MarkdownWriter, node: ProseMirrorNode) {
                    const language: string = node.attrs.language || '';
                    const fence = codeFenceFor(node.textContent, language);
                    state.write(fence + language + '\n');
                    state.text(node.textContent, false);
                    // Always a line break of its own before the closing fence: the reader takes one
                    // back, so code that ends in empty lines keeps every one of them.
                    state.write('\n');
                    state.write(fence);
                    state.closeBlock(node);
                },
            },
        };
    },
});
