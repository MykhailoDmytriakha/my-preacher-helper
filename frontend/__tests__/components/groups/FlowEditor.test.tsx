import { writeForeignEvidence } from '@test-utils/foreignContentEvidence';
import * as foreignContent from '@/components/ui/foreignContent';
import { baseTyping } from '@test-utils/foreignSelection';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';

import { markdown, mountedEditor } from '@test-utils/richMarkdownHistory';

import FlowEditor from '@/components/groups/FlowEditor';
import { GroupBlockTemplate, GroupFlowItem } from '@/models/models';

jest.mock('@/components/ui/foreignContent', () => ({
  ...jest.requireActual('@/components/ui/foreignContent'), __esModule: true,
}));

jest.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue || key,
    }),
}));

let mockRealEditor = false;
jest.mock('@/components/ui/RichMarkdownToolbar', () => ({ RichMarkdownToolbar: () => null }));
jest.mock('@/components/ui/RichMarkdownEditor', () => ({
    RichMarkdownEditor: (props: React.ComponentProps<typeof import('@/components/ui/RichMarkdownEditor').RichMarkdownEditor>) => {
      if (mockRealEditor) { const { RichMarkdownEditor } = jest.requireActual('@/components/ui/RichMarkdownEditor'); return <RichMarkdownEditor {...props} />; }
      const { value, onChange, placeholder } = props;
      return (
        <textarea
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={placeholder}
        />
    ); },
}));

let mockWide = true;
jest.mock('@/hooks/useMediaQuery', () => ({ useMediaQuery: () => mockWide }));

const mockFlowItem: GroupFlowItem = {
    id: 'f1',
    templateId: 't1',
    order: 1,
    durationMin: 15,
};

const mockTemplate: GroupBlockTemplate = {
    id: 't1',
    type: 'topic',
    title: 'Test Block',
    content: 'Initial content',
    status: 'draft',
    createdAt: 'x',
    updatedAt: 'x',
};

describe('FlowEditor', () => {
    const onUpdateTemplate = jest.fn();
    const onUpdateFlowItem = jest.fn();
    const onSetDuration = jest.fn().mockResolvedValue(undefined);
    const onSetStatus = jest.fn().mockResolvedValue(undefined);
    const onRenameBlock = jest.fn().mockResolvedValue(undefined);
    const onRenameStep = jest.fn().mockResolvedValue(undefined);
    const onClose = jest.fn();

    const defaultProps = {
        flowItem: mockFlowItem,
        template: mockTemplate,
        onUpdateTemplate,
        onUpdateFlowItem,
        onSetDuration,
        onSetStatus,
        onRenameBlock,
        onRenameStep,
        onClose,
    };

    it('keeps the group block caret and next character when its template refreshes', () => {
        mockRealEditor = true;
        const initial = 'Alpha abcdef END\n\nMiddle unchanged\n\nTail';
        try {
            const view = render(<FlowEditor {...defaultProps} template={{ ...mockTemplate, content: initial }} />);
            const editor = mountedEditor(view.container);
            const arrivalPath = jest.spyOn(foreignContent, 'applyForeignContent');
            act(() => { editor.commands.setTextSelection(10); editor.view.focus(); });
            view.rerender(<FlowEditor {...defaultProps} template={{ ...mockTemplate, content: initial.replace('Tail', 'PHONE Tail') }} />);
            const paths = arrivalPath.mock.results.map(result => result.value);
            arrivalPath.mockRestore();
            writeForeignEvidence('caller-group-far', paths);
            expect(editor.state.selection.head).toBe(10);
            expect(paths).toEqual([{ fallback: false }]);
            expect(onUpdateTemplate).not.toHaveBeenCalled();
            act(() => { editor.commands.insertContent('X'); });
            expect(markdown(editor)).toBe('Alpha abcXdef END\n\nMiddle unchanged\n\nPHONE Tail');
            expect(onUpdateTemplate).toHaveBeenCalledWith({ content: markdown(editor) });
        } finally { mockRealEditor = false; }
    });

    it('stores the production result after an adjacent arrival in the group block', () => {
        mockRealEditor = true;
        const initial = 'First words\n\nLast words\n\nTail';
        try {
            const view = render(<FlowEditor {...defaultProps} template={{ ...mockTemplate, content: initial }} />);
            const editor = mountedEditor(view.container);
            const arrivalPath = jest.spyOn(foreignContent, 'applyForeignContent');
            act(() => { editor.commands.setTextSelection(4); editor.view.focus(); });
            const adopted = initial.replace('Last words', 'PHONEARRIVAL sacred words\n\nLast words');
            const expected = baseTyping(editor, adopted);
            view.rerender(<FlowEditor {...defaultProps} template={{ ...mockTemplate, content: adopted }} />);

            expect(onUpdateTemplate).not.toHaveBeenCalled();
            const paths = arrivalPath.mock.results.map(result => result.value);
            arrivalPath.mockRestore();
            writeForeignEvidence('caller-group-adjacent', paths);
            expect(paths.every(result => result.fallback)).toBe(true);
            expect(editor.state.doc.toJSON()).toEqual(expected.document);
            expect(editor.state.selection.toJSON()).toEqual(expected.selection);
            act(() => { editor.commands.insertContent('X'); });
            expect(markdown(editor)).toBe(expected.typed);
            expect(onUpdateTemplate).toHaveBeenCalledWith({ content: markdown(editor) });
        } finally { mockRealEditor = false; }
    });

    it.each([false, true])('gives the block editor a keyboard boundary only on a narrow screen (wide=%s)', wide => {
        mockWide = wide;
        function GroupFlow() {
            const [open, setOpen] = useState(false);
            return <>
                <button type="button" onClick={() => setOpen(true)}>Open block</button>
                {open && <FlowEditor {...defaultProps} onClose={() => setOpen(false)} />}
            </>;
        }
        const view = render(<GroupFlow />);
        try {
            const opener = screen.getByRole('button', { name: 'Open block' });
            opener.focus();
            fireEvent.click(opener);
            const close = screen.getByRole('button', { name: 'common.close' });
            const last = screen.getByRole('textbox', { name: 'Leader Notes' });
            last.focus();
            fireEvent.keyDown(last, { key: 'Tab' });
            expect(wide ? last : close).toHaveFocus();
            close.focus();
            fireEvent.keyDown(close, { key: 'Tab', shiftKey: true });
            expect(wide ? close : last).toHaveFocus();
            fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
            if (wide) expect(close).toBeInTheDocument();
            else {
                expect(close).not.toBeInTheDocument();
                expect(opener).toHaveFocus();
            }
        } finally {
            view.unmount();
            mockWide = true;
        }
    });

    it('renders editor fields', () => {
        render(<FlowEditor {...defaultProps} />);
        expect(screen.getByDisplayValue('Test Block')).toBeInTheDocument(); // Title input
        expect(screen.getByDisplayValue('Initial content')).toBeInTheDocument(); // Content textarea
        expect(screen.getByDisplayValue('15')).toBeInTheDocument(); // Duration input
    });

    it('updates template title', () => {
        render(<FlowEditor {...defaultProps} />);
        const input = screen.getByDisplayValue('Test Block');
        fireEvent.change(input, { target: { value: 'New Title' } });
        expect(onRenameBlock).toHaveBeenCalledWith('New Title');
    });

    it('updates content', () => {
        render(<FlowEditor {...defaultProps} />);
        const textarea = screen.getByDisplayValue('Initial content');
        fireEvent.change(textarea, { target: { value: 'New content' } });
        expect(onUpdateTemplate).toHaveBeenCalledWith({ content: 'New content' });
    });

    it('updates duration', () => {
        render(<FlowEditor {...defaultProps} />);
        const input = screen.getByDisplayValue('15');
        fireEvent.change(input, { target: { value: '20' } });
        expect(onSetDuration).toHaveBeenCalledWith(20);
    });

    it('updates step title', () => {
        render(<FlowEditor {...defaultProps} />);
        // Initial value is flowItem.instanceTitle which is undefined in mock?
        // mockFlowItem doesn't have it. So it empty string.
        // The placeholder is template.title ("Test Block").
        // We can finding by label 'Step title'.
        const input = screen.getByLabelText('Step title');
        fireEvent.change(input, { target: { value: 'My Step' } });
        expect(onRenameStep).toHaveBeenCalledWith('My Step');
    });

    it('updates notes', () => {
        render(<FlowEditor {...defaultProps} />);
        const textarea = screen.getByLabelText('Leader Notes');
        fireEvent.change(textarea, { target: { value: 'My notes' } });
        expect(onUpdateFlowItem).toHaveBeenCalledWith({ instanceNotes: 'My notes' });
    });

    it('updates status', () => {
        render(<FlowEditor {...defaultProps} />);
        // Status buttons have labelKey?
        // They render text from t(option.labelKey).
        // Options: Empty, Draft, Filled.
        const filledBtn = screen.getByText('Filled');
        fireEvent.click(filledBtn);
        expect(onSetStatus).toHaveBeenCalledWith('filled');
    });

    it('calls onClose', () => {
        render(<FlowEditor {...defaultProps} />);
        const closeBtn = screen.getByLabelText('common.close');
        fireEvent.click(closeBtn);
        expect(onClose).toHaveBeenCalled();
    });

    it('keeps the block title and close button in view while the fields scroll in their own contained area', () => {
        render(
            <FlowEditor
                flowItem={mockFlowItem}
                template={mockTemplate}
                onUpdateTemplate={onUpdateTemplate}
                onUpdateFlowItem={onUpdateFlowItem}
                onSetDuration={onSetDuration}
                onSetStatus={onSetStatus}
                onRenameBlock={onRenameBlock}
                onRenameStep={onRenameStep}
                onClose={onClose}
            />
        );

        // The header never scrolls away with a long block.
        expect(screen.getByLabelText('common.close').closest('.overflow-y-auto')).toBeNull();
        // The fields scroll inside the panel and do not hand the wheel over to the page behind.
        const fields = screen.getByLabelText('Block Name (Template)').closest('.overflow-y-auto');
        expect(fields).not.toBeNull();
        expect(fields).toHaveClass('overscroll-contain');
    });
});
