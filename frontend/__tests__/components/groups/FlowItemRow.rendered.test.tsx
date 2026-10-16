// Runs against the REAL react-markdown, not the global stub in jest.setup.js — the point is to see
// the block's Markdown come out as elements in the flow row on the group page
// (see app/components/ui/__tests__/FoldableMarkdown.rendered.test.tsx for why unmock works here).
jest.unmock('react-markdown');
jest.unmock('remark-gfm');
jest.unmock('rehype-raw');
jest.unmock('rehype-sanitize');

import { fireEvent, render, screen } from '@testing-library/react';

import { ScriptureLinks } from '@/components/bible/ScriptureLinks';
import FlowItemRow from '@/components/groups/FlowItemRow';

import type { GroupBlockTemplate, GroupFlowItem } from '@/models/models';

jest.mock('react-i18next', () => ({
    useTranslation: () => ({ t: (key: string, opts?: { defaultValue?: string }) => opts?.defaultValue ?? key }),
}));

jest.mock('@dnd-kit/sortable', () => ({
    useSortable: () => ({
        attributes: {}, listeners: {}, setNodeRef: jest.fn(), transform: null, transition: undefined, isDragging: false,
    }),
}));

const template: GroupBlockTemplate = {
    id: 't1', type: 'topic', title: 'Main Topic', status: 'draft', createdAt: '', updatedAt: '',
    content: '## Opening\n\n**Pray** together, see [the passage](https://example.com/john-3)\n\n- first\n- second',
};
const flowItem: GroupFlowItem = { id: 'f1', templateId: 't1', order: 1, durationMin: null };

const renderRow = (onSelect = jest.fn()) => {
    render(
        <FlowItemRow
            flowItem={flowItem} template={template} index={0} isSelected={false} isFirst isLast
            onSelect={onSelect} onStatusCycle={jest.fn()} onMoveUp={jest.fn()} onMoveDown={jest.fn()}
            onDuplicate={jest.fn()} onDelete={jest.fn()}
        />
    );
    return onSelect;
};

it('shows the block content as formatted text: heading, bold and list', () => {
    renderRow();
    expect(screen.getByRole('heading', { name: 'Opening' })).toBeInTheDocument();
    expect(screen.getByText('Pray').tagName).toBe('STRONG');
    expect(screen.getAllByRole('listitem').map((item) => item.textContent)).toEqual(['first', 'second']);
    expect(screen.queryByText(/\*\*Pray\*\*/)).not.toBeInTheDocument();
});

it('opens a link in the content without selecting the row, and still selects it from its text', () => {
    const onSelect = renderRow();
    fireEvent.click(screen.getByRole('link', { name: 'the passage' }));
    expect(onSelect).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('Pray'));
    expect(onSelect).toHaveBeenCalledTimes(1);
});

it("wraps a leader's note that has no spaces inside the row", () => {
    // A pasted link is one word wider than an iPad: with no break rule it stretched the page sideways
    // and pushed "Start meeting" off screen (BUG-20261010-group-long-note-pushes-start-off-screen).
    // jsdom lays nothing out, so the rule itself is the seam; the width is measured in WebKit.
    const word = `https://example.com/${'x'.repeat(200)}`;
    render(
        <FlowItemRow
            flowItem={{ ...flowItem, instanceNotes: word }} template={template} index={0} isSelected={false} isFirst isLast
            onSelect={jest.fn()} onStatusCycle={jest.fn()} onMoveUp={jest.fn()} onMoveDown={jest.fn()}
            onDuplicate={jest.fn()} onDelete={jest.fn()}
        />
    );
    expect(screen.getByText(word)).toHaveClass('break-words');
});

// On the group page a reference in a block's text is a link to the Bible (the page gives the way to
// open it): pressing it opens the passage and does not select the block it sits in.
it('opens a reference in the block text without selecting the block', () => {
    const onSelect = jest.fn();
    const onOpen = jest.fn();
    render(
        <ScriptureLinks onOpen={onOpen}>
            <FlowItemRow
                flowItem={{ ...flowItem, instanceTitle: 'Чтение: Рим 13', instanceNotes: 'Дома: Еф 4:1' }}
                template={{ ...template, content: 'Бытие 13:1–12.\n\nВот здесь мне особенно нравится текст.' }}
                index={0} isSelected={false} isFirst isLast
                onSelect={onSelect} onStatusCycle={jest.fn()} onMoveUp={jest.fn()} onMoveDown={jest.fn()}
                onDuplicate={jest.fn()} onDelete={jest.fn()}
            />
        </ScriptureLinks>
    );
    fireEvent.click(screen.getByRole('button', { name: 'Бытие 13:1–12' }));
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ book: 'Genesis', chapter: 13, fromVerse: 1, toVerse: 12, label: 'Бытие 13:1–12' }));
    expect(onSelect).not.toHaveBeenCalled();
    // The block's title and the leader's note carry their references too.
    fireEvent.click(screen.getByRole('button', { name: 'Рим 13' }));
    fireEvent.click(screen.getByRole('button', { name: 'Еф 4:1' }));
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ book: 'Romans', chapter: 13 }));
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ book: 'Ephesians', chapter: 4, fromVerse: 1 }));
    expect(onSelect).not.toHaveBeenCalled();
});
