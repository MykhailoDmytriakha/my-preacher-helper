import { mergeAttributes, Node, nodeInputRule } from '@tiptap/core';
import { Fragment, type Node as ProseMirrorNode } from '@tiptap/pm/model';
import { ReactNodeViewRenderer } from '@tiptap/react';

import WikilinkChip from './WikilinkChip';
import {
  STUDIES_LINK_PREFIX,
  WIKILINK_CHIP_CLASS,
  WIKILINK_CHIP_GLYPH,
  WIKILINK_DATA_ATTR,
  WIKILINK_ID_REGEX_SOURCE,
} from './wikilinkConstants';

import type MarkdownIt from 'markdown-it';
import type StateInline from 'markdown-it/lib/rules_inline/state_inline.mjs';
import type { MarkdownSerializerState } from 'prosemirror-markdown';

export interface WikilinkOptions {
  resolver?: (id: string) => string | undefined;
}

type WikilinkMarkdownStorage = {
  markdown: {
    serialize: (state: MarkdownSerializerState, node: ProseMirrorNode) => void;
    parse: {
      setup: (markdownit: MarkdownIt) => void;
    };
  };
};

const WIKILINK_ID_PATTERN = new RegExp(`^${WIKILINK_ID_REGEX_SOURCE}$`);
const WIKILINK_MARKDOWN_PATTERN = new RegExp(`^\\[\\[(${WIKILINK_ID_REGEX_SOURCE})\\]\\]`);
const WIKILINK_INPUT_RULE = new RegExp(`\\[\\[(${WIKILINK_ID_REGEX_SOURCE})\\]\\]$`);

function isValidWikilinkId(value: string | null): value is string {
  return Boolean(value && WIKILINK_ID_PATTERN.test(value));
}

function installWikilinkMarkdownRule(markdownit: MarkdownIt): void {
  const wikilinkRule = (state: StateInline, silent: boolean): boolean => {
    if (state.src.charCodeAt(state.pos) !== 0x5B || state.src.charCodeAt(state.pos + 1) !== 0x5B) {
      return false;
    }

    const match = WIKILINK_MARKDOWN_PATTERN.exec(state.src.slice(state.pos));
    if (!match) return false;

    if (!silent) {
      const id = match[1];
      const escapedId = state.md.utils.escapeHtml(id);
      const token = state.push('html_inline', '', 0);
      token.content = `<a ${WIKILINK_DATA_ATTR}="${escapedId}" href="${STUDIES_LINK_PREFIX}${escapedId}">${WIKILINK_CHIP_GLYPH} ${escapedId}</a>`;
    }

    state.pos += match[0].length;
    return true;
  };

  try {
    markdownit.inline.ruler.at('wikilink', wikilinkRule);
  } catch {
    markdownit.inline.ruler.before('link', 'wikilink', wikilinkRule);
  }
}

export const Wikilink = Node.create<WikilinkOptions, WikilinkMarkdownStorage>({
  name: 'wikilink',
  priority: 1000,

  inline: true,
  group: 'inline',
  atom: true,
  selectable: false,

  addOptions() {
    return {
      resolver: undefined,
    };
  },

  addAttributes() {
    return {
      id: {
        default: '',
        parseHTML: (element: HTMLElement) => element.getAttribute(WIKILINK_DATA_ATTR) ?? '',
        renderHTML: (attributes: { id?: string }) => ({
          [WIKILINK_DATA_ATTR]: attributes.id ?? '',
        }),
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: `a[${WIKILINK_DATA_ATTR}]`,
        priority: 1000,
        getContent: () => Fragment.empty,
        getAttrs: (element) => {
          if (!(element instanceof HTMLElement)) return false;
          const id = element.getAttribute(WIKILINK_DATA_ATTR);
          return isValidWikilinkId(id) ? { id } : false;
        },
      },
    ];
  },

  renderHTML({ node, HTMLAttributes }) {
    const id = typeof node.attrs.id === 'string' ? node.attrs.id : '';

    return [
      'a',
      mergeAttributes(HTMLAttributes, {
        class: WIKILINK_CHIP_CLASS,
        [WIKILINK_DATA_ATTR]: id,
        href: `${STUDIES_LINK_PREFIX}${id}`,
        contenteditable: 'false',
      }),
      `${WIKILINK_CHIP_GLYPH} ${id}`,
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(WikilinkChip);
  },

  addInputRules() {
    return [
      nodeInputRule({
        find: WIKILINK_INPUT_RULE,
        type: this.type,
        getAttributes: (match) => ({
          id: match[1],
        }),
      }),
    ];
  },

  addStorage() {
    return {
      markdown: {
        serialize(state, node) {
          const id = typeof node.attrs.id === 'string' ? node.attrs.id : '';
          state.write(`[[${id}]]`);
        },
        parse: {
          setup(markdownit) {
            // `tiptap-markdown` parses markdown by first rendering it to HTML
            // with markdown-it, then feeding that HTML through TipTap's schema
            // parser. This inline rule turns raw `[[id]]` text into temporary
            // `a[data-wikilink-id]` HTML so the normal `parseHTML` rule creates
            // a real atom node during initial `setContent` and external syncs.
            installWikilinkMarkdownRule(markdownit);
          },
        },
      },
    };
  },
});

export default Wikilink;
