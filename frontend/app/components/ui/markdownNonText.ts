import { Extension, Node } from '@tiptap/core';
import { isHistoryTransaction } from '@tiptap/pm/history';
import { DOMSerializer, Fragment, Slice } from '@tiptap/pm/model';
import { Plugin } from '@tiptap/pm/state';
import { dropPoint, Mapping, ReplaceStep } from '@tiptap/pm/transform';

import type { Node as DocumentNode } from '@tiptap/pm/model';
import type { Transaction } from '@tiptap/pm/state';

interface MarkdownWriter {
    text(content: string, escape?: boolean): void;
    write(content: string): void;
    esc(content: string): string;
    closeBlock(node: DocumentNode): void;
}

const COMMENT_ATTRIBUTE = 'data-markdown-comment';
const IMAGE_SOURCE = 'data-markdown-image-src';
const BLOCK_PARENTS = new Set(['BLOCKQUOTE', 'LI', 'TD', 'TH']);

function retainComments(root: HTMLElement): void {
    const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_COMMENT);
    const comments: Comment[] = [];
    for (let node = walker.nextNode(); node; node = walker.nextNode()) comments.push(node as Comment);
    for (const comment of comments) {
        const parent = comment.parentElement;
        if (!parent) continue;
        const block = parent === root || BLOCK_PARENTS.has(parent.tagName);
        const placeholder = root.ownerDocument.createElement(block ? 'div' : 'span');
        placeholder.setAttribute(COMMENT_ATTRIBUTE, comment.data);
        comment.replaceWith(placeholder);
    }
}

function validCommentSource(source: string | null): boolean {
    // The attribute can also arrive from authored HTML or an external clipboard.
    return source !== null && !/^(?:>|->)|--!?>/.test(source);
}

function commentNode(inline: boolean) {
    const tag = inline ? 'span' : 'div';
    return Node.create({
        name: inline ? 'markdownInlineComment' : 'markdownBlockComment',
        group: inline ? 'inline' : 'block',
        inline,
        atom: true,
        selectable: false,
        addAttributes() {
            return { source: { default: '', parseHTML: element => element.getAttribute(COMMENT_ATTRIBUTE) ?? '' } };
        },
        parseHTML() {
            return [{
                tag: `${tag}[${COMMENT_ATTRIBUTE}]`,
                getAttrs: element => validCommentSource(element.getAttribute(COMMENT_ATTRIBUTE)) ? null : false,
            }];
        },
        renderHTML({ node }) {
            return [tag, { [COMMENT_ATTRIBUTE]: node.attrs.source, hidden: 'hidden', 'aria-hidden': 'true' }];
        },
        addStorage() {
            return {
                markdown: {
                    ...(inline ? {} : { parse: { updateDOM: retainComments } }),
                    serialize(state: MarkdownWriter, node: DocumentNode, parent: DocumentNode, index: number) {
                        // A bare comment at the start of a Markdown line consumes the remaining
                        // line as raw HTML. An empty inline tag keeps the neighboring marks live.
                        if (inline && (index === 0 || parent.child(index - 1).type.name === 'hardBreak')) state.text('<span></span>', false);
                        state.text(`<!--${node.attrs.source}-->`, false);
                        if (!inline) state.closeBlock(node);
                    },
                },
            };
        },
    });
}

export const MarkdownBlockComment = commentNode(false);
export const MarkdownInlineComment = commentNode(true);

function visibleImageSource(source: string): string | null {
    try {
        const url = new URL(source, 'https://example.invalid');
        return url.protocol === 'https:' || url.protocol === 'http:' ? source : null;
    } catch {
        return null;
    }
}

function htmlImage(inert: Document, node: DocumentNode) {
    const image = inert.createElement('img');
    const { src, alt, title } = node.attrs;
    const visible = visibleImageSource(src);
    image.setAttribute(visible ? 'src' : IMAGE_SOURCE, visible ?? src);
    image.setAttribute('alt', alt ?? '');
    if (title != null) image.setAttribute('title', title);
    return image;
}

type MarkdownToken = { type: string; children: MarkdownToken[] | null };
type ImageRenderer = (tokens: MarkdownToken[], index: number, ...arguments_: unknown[]) => string;
type MarkdownRenderer = { render(...arguments_: unknown[]): string; renderer: { rules: { image?: ImageRenderer } } };
const preparedImageRenderers = new WeakSet<MarkdownRenderer>();

function preserveAltTokens(token: MarkdownToken): void {
    for (const child of token.children ?? []) {
        // Markdown-it's plain image label skips these tokens inside nested inline content.
        if (child.type === 'text_special' || child.type === 'code_inline') child.type = 'text';
        else if (child.type === 'image') preserveAltTokens(child);
    }
}

function preserveMarkdownImages(markdown: MarkdownRenderer): void {
    const imageRule = markdown.renderer.rules.image;
    if (!imageRule || preparedImageRenderers.has(markdown)) return;
    preparedImageRenderers.add(markdown);
    markdown.renderer.rules.image = (tokens, index, ...arguments_) => {
        preserveAltTokens(tokens[index]);
        return imageRule(tokens, index, ...arguments_);
    };
    const render = markdown.render.bind(markdown);
    markdown.render = (...arguments_) => {
        const html = render(...arguments_);
        if (!/<img\b/i.test(html)) return html;
        // Parse into a template with no browsing context. Even the HTML passed
        // to Tiptap's DOM parser carries no active image URL.
        const template = document.implementation.createHTMLDocument().createElement('template');
        template.innerHTML = html;
        const images = template.content.querySelectorAll(`img[src], img[${IMAGE_SOURCE}]`);
        for (const image of images) {
            const span = template.content.ownerDocument.createElement('span');
            span.setAttribute(IMAGE_SOURCE, image.getAttribute(IMAGE_SOURCE) ?? image.getAttribute('src') ?? '');
            for (const attribute of ['alt', 'title']) {
                const value = image.getAttribute(attribute);
                if (value !== null) span.setAttribute(attribute, value);
            }
            image.replaceWith(span);
        }
        return template.innerHTML;
    };
}

/** The editing and clipboard DOM carry media attributes without a network address. */
export const MarkdownImage = Node.create({
    name: 'image',
    group: 'inline',
    inline: true,
    atom: true,
    selectable: false,
    addAttributes() {
        return {
            src: { default: '', parseHTML: element => element.getAttribute(IMAGE_SOURCE) ?? element.getAttribute('src') ?? '' },
            alt: { default: '' },
            title: { default: null },
        };
    },
    parseHTML() { return [{ tag: 'img[src]' }, { tag: `img[${IMAGE_SOURCE}]` }, { tag: `span[${IMAGE_SOURCE}]` }]; },
    renderHTML({ node }) {
        const { src, alt, title } = node.attrs;
        return ['span', { [IMAGE_SOURCE]: src, alt, title, hidden: 'hidden', 'aria-hidden': 'true' }];
    },
    addStorage() {
        return { markdown: { parse: { setup: preserveMarkdownImages }, serialize(state: MarkdownWriter, node: DocumentNode) {
            const { src, alt, title } = node.attrs;
            if (!visibleImageSource(src) || /[\s<>&]/.test(src) || /[\r\n&]/.test(alt ?? '') || /[\r\n&]/.test(title ?? '')) {
                state.write(htmlImage(document.implementation.createHTMLDocument(), node).outerHTML);
                return;
            }
            const address = src.replace(/[()\\]/g, '\\$&');
            const suffix = title ? ' "' + title.replace(/["\\]/g, '\\$&') + '"' : '';
            state.write('![' + state.esc(alt ?? '') + '](' + address + suffix + ')');
        } } };
    },
});

const nonTextNodes = new Set([MarkdownBlockComment.name, MarkdownInlineComment.name, MarkdownImage.name]);

const opaqueKey = (node: DocumentNode) => JSON.stringify([node.type.name, node.attrs]);

function removedAtoms(transactions: readonly Transaction[]) {
    const mapping = new Mapping();
    for (const transaction of transactions) mapping.appendMapping(transaction.mapping);
    const removed: { node: DocumentNode; position: number }[] = [];
    let index = 0;
    for (const transaction of transactions) {
        for (const [step, map] of transaction.mapping.maps.entries()) {
            const remainder = mapping.slice(++index);
            map.forEach((from, to, start, end) => {
                if (from === to) return;
                transaction.docs[step].nodesBetween(from, to, (node, position) => {
                    if (!nonTextNodes.has(node.type.name) || position < from || position + node.nodeSize > to) return;
                    removed.push({ node, position: remainder.map(start + Math.min(position - from, end - start)) });
                });
            });
        }
    }
    return removed;
}

function opaqueDeficits(before: DocumentNode, after: DocumentNode, candidates: readonly { node: DocumentNode }[]) {
    const counts = new Map(candidates.map(({ node }) => [opaqueKey(node), 0]));
    const count = (document: DocumentNode, delta: number) => document.descendants(node => {
        if (!nonTextNodes.has(node.type.name)) return;
        const key = opaqueKey(node), prior = counts.get(key);
        if (prior !== undefined) counts.set(key, prior + delta);
    });
    count(before, 1);
    count(after, -1);
    return counts;
}

const trustedReplacement = (transaction: Transaction) =>
    transaction.getMeta('preventUpdate') || isHistoryTransaction(transaction);


/** A single Backspace at a visible boundary cannot mean deleting an invisible atom. */
export const MarkdownNonTextBoundaries = Extension.create({
    name: 'markdownNonTextBoundaries',
    addProseMirrorPlugins() {
        return [new Plugin({
            filterTransaction(transaction) {
                if (!transaction.docChanged || trustedReplacement(transaction) || transaction.steps.length !== 1) return true;
                const [step] = transaction.steps;
                if (!(step instanceof ReplaceStep) || step.slice.size) return true;
                const node = transaction.before.nodeAt(step.from);
                return !(node && nonTextNodes.has(node.type.name) && step.to - step.from === node.nodeSize);
            },
            appendTransaction(transactions, before, after) {
                if (transactions.some(trustedReplacement)) return;
                const candidates = removedAtoms(transactions);
                if (!candidates.length) return;
                const deficits = opaqueDeficits(before.doc, after.doc, candidates);
                const transaction = after.tr;
                for (const { node, position } of candidates) {
                    const key = opaqueKey(node);
                    const missing = deficits.get(key) ?? 0;
                    if (missing < 1) continue;
                    const mapped = transaction.mapping.map(position);
                    const destination = dropPoint(transaction.doc, mapped, new Slice(Fragment.from(node), 0, 0));
                    if (destination !== null) transaction.replaceRangeWith(destination, destination, node);
                    else {
                        const block = node.isInline ? after.schema.nodes.paragraph.create(null, node) : node;
                        transaction.insert(transaction.doc.content.size, block);
                    }
                    deficits.set(key, missing - 1);
                }
                return transaction.docChanged ? transaction : undefined;
            },
        })];
    },
});

export function serializeMarkdownHtmlTable(table: DocumentNode): string {
    const inert = document.implementation.createHTMLDocument();
    const serializer = DOMSerializer.fromSchema(table.type.schema);
    const comment = (node: DocumentNode) => inert.createComment(node.attrs.source);
    const html = new DOMSerializer({
        ...serializer.nodes,
        [MarkdownBlockComment.name]: comment,
        [MarkdownInlineComment.name]: comment,
        [MarkdownImage.name]: node => htmlImage(inert, node),
    }, serializer.marks);
    const container = inert.createElement('div');
    html.serializeFragment(Fragment.from(table), { document: inert }, container);
    return container.innerHTML;
}
