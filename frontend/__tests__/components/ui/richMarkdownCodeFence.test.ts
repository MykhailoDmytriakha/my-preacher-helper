import { Editor } from '@tiptap/core';

import { richMarkdownExtensions } from '@/components/ui/richMarkdownExtensions';
import { codeFenceFor } from '@/utils/markdownFence';

/**
 * What is typed into a code block stays a code block after a save and a reload, whatever its
 * characters. The saved Markdown is the note itself, so the round trip is the whole check.
 */
const markdownOf = (editor: Editor) => (editor.storage as unknown as { markdown: { getMarkdown(): string } }).markdown.getMarkdown();

function roundTrip(markdown: string) {
    const saving = new Editor({ extensions: richMarkdownExtensions(), content: markdown });
    const saved = markdownOf(saving);
    const reopened = new Editor({ extensions: richMarkdownExtensions(), content: saved });
    const result = { saved, again: markdownOf(reopened), json: reopened.getJSON() };
    saving.destroy();
    reopened.destroy();
    return result;
}

describe('a code block in the rich Markdown editor', () => {
    it('keeps a line of three backticks inside the block after a save and a reload', () => {
        const typed = '````\n```\n# Inside code\n```\n````';
        const { saved, json } = roundTrip(typed);

        expect(saved).toBe(typed);
        expect(json.content).toHaveLength(1);
        expect(json.content?.[0]).toMatchObject({ type: 'codeBlock', content: [{ type: 'text', text: '```\n# Inside code\n```' }] });
    });

    it('fences with one backtick more than the longest run inside, and keeps the language', () => {
        expect(roundTrip('`````js\nconst a = "````";\n`````').saved).toBe('`````js\nconst a = "````";\n`````');
    });

    it('still writes three backticks for ordinary code', () => {
        expect(roundTrip('```\nconst a = 1;\n```').saved).toBe('```\nconst a = 1;\n```');
    });

    it('keeps inline code that holds backticks as inline code', () => {
        const { again, json } = roundTrip('Type `` ` `` to quote and ```` ``` ```` to fence.');
        expect(again).toBe('Type `` ` `` to quote and ```` ``` ```` to fence.');
        expect(JSON.stringify(json)).not.toContain('"codeBlock"');
    });

    it('keeps a language name that holds a backtick, fencing with tildes', () => {
        const { saved, json } = roundTrip('~~~foo`bar\n# Inside code\n~~~');
        expect(saved).toBe('~~~foo`bar\n# Inside code\n~~~');
        expect(json.content).toEqual([{ type: 'codeBlock', attrs: { language: 'foo`bar' }, content: [{ type: 'text', text: '# Inside code' }] }]);
    });

    it('keeps the empty lines a code block ends with, save after save', () => {
        const first = roundTrip('```\nx\n\n\n```');
        expect(first.json.content?.[0]).toMatchObject({ type: 'codeBlock', content: [{ type: 'text', text: 'x\n\n' }] });
        expect(roundTrip(first.saved).saved).toBe(first.saved);
    });

    it('keeps an empty code block empty', () => {
        const { json } = roundTrip('```\n\n```');
        expect(json.content).toEqual([{ type: 'codeBlock', attrs: { language: null } }]);
    });
});

describe('codeFenceFor', () => {
    it('measures a huge block of code without running out of stack', () => {
        // 150,000 separate backticks: a list of every run, spread into one call, overflowed the stack.
        expect(codeFenceFor('` '.repeat(150000))).toBe('```');
        expect(codeFenceFor('`'.repeat(150000))).toHaveLength(150001);
    });
});

