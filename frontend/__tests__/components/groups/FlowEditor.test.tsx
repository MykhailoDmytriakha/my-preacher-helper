import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';

import FlowEditor from '@/components/groups/FlowEditor';
import { GroupBlockTemplate, GroupFlowItem } from '@/models/models';

jest.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue || key,
    }),
}));

jest.mock('@/components/ui/RichMarkdownEditor', () => ({
    RichMarkdownEditor: ({ value, onChange, placeholder }: any) => (
        <textarea
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={placeholder}
        />
    ),
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
    const onRenameBlock = jest.fn().mockResolvedValue(undefined);
    const onRenameStep = jest.fn().mockResolvedValue(undefined);
    const onClose = jest.fn();

    const defaultProps = {
        flowItem: mockFlowItem,
        template: mockTemplate,
        onUpdateTemplate,
        onUpdateFlowItem,
        onRenameBlock,
        onRenameStep,
        onClose,
    };

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
        expect(onUpdateFlowItem).toHaveBeenCalledWith({ durationMin: 20 });
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
        expect(onUpdateTemplate).toHaveBeenCalledWith({ status: 'filled' });
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

