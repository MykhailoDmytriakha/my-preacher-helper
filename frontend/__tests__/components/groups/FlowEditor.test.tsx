import { fireEvent, render, screen } from '@testing-library/react';

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
    const onClose = jest.fn();

    const defaultProps = {
        flowItem: mockFlowItem,
        template: mockTemplate,
        onUpdateTemplate,
        onUpdateFlowItem,
        onClose,
    };

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
        expect(onUpdateTemplate).toHaveBeenCalledWith({ title: 'New Title' });
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
        expect(onUpdateFlowItem).toHaveBeenCalledWith({ instanceTitle: 'My Step' });
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
        const closeBtn = screen.getByLabelText('Close editor');
        fireEvent.click(closeBtn);
        expect(onClose).toHaveBeenCalled();
    });
});
