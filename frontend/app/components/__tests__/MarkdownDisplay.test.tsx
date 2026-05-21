import type { Link, Paragraph, Root } from 'mdast';
import type { Processor } from 'unified';

import { STUDIES_LINK_PREFIX, WIKILINK_CHIP_GLYPH } from '@components/studies/node/wikilinkConstants';
import { remarkWikilinks } from '../MarkdownDisplay';

const resolver = (id: string) => (id === 'abc' ? 'Resolved Note' : undefined);

const applyWikilinks = (tree: Root) => {
    const transformer = remarkWikilinks.call({} as Processor, { resolver });

    if (typeof transformer !== 'function') {
        throw new Error('remarkWikilinks did not return a transformer');
    }

    (transformer as (tree: Root) => void)(tree);
    return tree;
};

describe('remarkWikilinks', () => {
    it('turns plain prose wikilinks into marked study links', () => {
        const tree = applyWikilinks({
            type: 'root',
            children: [
                {
                    type: 'paragraph',
                    children: [{ type: 'text', value: 'See [[abc]] today.' }],
                },
            ],
        });

        const paragraph = tree.children[0] as Paragraph;
        expect(paragraph.children).toHaveLength(3);
        expect(paragraph.children[0]).toEqual({ type: 'text', value: 'See ' });

        const link = paragraph.children[1] as Link;
        expect(link.type).toBe('link');
        expect(link.url).toBe(`${STUDIES_LINK_PREFIX}abc#wiki`);
        expect(link.children).toEqual([{ type: 'text', value: `${WIKILINK_CHIP_GLYPH} Resolved Note` }]);

        expect(paragraph.children[2]).toEqual({ type: 'text', value: ' today.' });
    });

    it('leaves fenced code block wikilinks literal', () => {
        const tree = applyWikilinks({
            type: 'root',
            children: [{ type: 'code', value: '[[abc]]' }],
        });

        expect(tree.children).toEqual([{ type: 'code', value: '[[abc]]' }]);
    });

    it('leaves inline code wikilinks literal', () => {
        const tree = applyWikilinks({
            type: 'root',
            children: [
                {
                    type: 'paragraph',
                    children: [{ type: 'inlineCode', value: '[[abc]]' }],
                },
            ],
        });

        const paragraph = tree.children[0] as Paragraph;
        expect(paragraph.children).toEqual([{ type: 'inlineCode', value: '[[abc]]' }]);
    });

    it('leaves wikilinks literal inside existing link labels', () => {
        const tree = applyWikilinks({
            type: 'root',
            children: [
                {
                    type: 'paragraph',
                    children: [
                        {
                            type: 'link',
                            url: '/some/url',
                            children: [{ type: 'text', value: '[[abc]]' }],
                        },
                    ],
                },
            ],
        });

        const paragraph = tree.children[0] as Paragraph;
        expect(paragraph.children).toEqual([
            {
                type: 'link',
                url: '/some/url',
                children: [{ type: 'text', value: '[[abc]]' }],
            },
        ]);
    });
});
