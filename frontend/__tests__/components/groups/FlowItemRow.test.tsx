import { fireEvent, render, screen } from '@testing-library/react';

import FlowItemRow from '@/components/groups/FlowItemRow';
import { GroupBlockTemplate, GroupFlowItem } from '@/models/models';

jest.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue || key,
    }),
}));

jest.mock('@dnd-kit/sortable', () => ({
    useSortable: () => ({
        attributes: {},
        listeners: {},
        setNodeRef: jest.fn(),
        transform: { x: 10, y: 10, scaleX: 1, scaleY: 1 },
        transition: 'transform 0.1s',
        isDragging: false,
    }),
    CSS: {
        Transform: {
            toString: jest.fn(() => 'translate3d(10px, 10px, 0) scaleX(1) scaleY(1)'),
        },
    },
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
    content: 'Test content snippet',
    status: 'draft',
    createdAt: 'x',
    updatedAt: 'x',
};

describe('FlowItemRow', () => {
    const defaultProps = {
        flowItem: mockFlowItem,
        template: mockTemplate,
        index: 0,
        isSelected: false,
        isFirst: false,
        isLast: false,
        onSelect: jest.fn(),
        onStatusCycle: jest.fn(),
        onMoveUp: jest.fn(),
        onMoveDown: jest.fn(),
        onDuplicate: jest.fn(),
        onDelete: jest.fn(),
    };

    it('renders block details correctly', () => {
        render(<FlowItemRow {...defaultProps} />);
        expect(screen.getByText('1')).toBeInTheDocument();
        expect(screen.getByText('Test Block')).toBeInTheDocument();
        expect(screen.getByText('Test content snippet')).toBeInTheDocument();
        expect(screen.getByText('15m')).toBeInTheDocument(); // 15 + "m" from default value
    });

    it('renders correct status color and label', () => {
        const { rerender } = render(<FlowItemRow {...defaultProps} template={{ ...mockTemplate, status: 'filled' }} />);
        const statusDot = screen.getByTitle('Filled'); // default label
        expect(statusDot).toBeInTheDocument();
        // Check wrapper class? Button has title.

        rerender(<FlowItemRow {...defaultProps} template={{ ...mockTemplate, status: 'empty' }} />);
        expect(screen.getByTitle('Empty')).toBeInTheDocument();
    });

    it('handles click to select', () => {
        render(<FlowItemRow {...defaultProps} />);
        fireEvent.click(screen.getByRole('button', { name: /Test Block/i })); // The main div has role button? No, let's check structure.
        // The main div has role="button".
        // But it contains other buttons.
        // We can find by text content or testid.
        // The main container text includes "1", "Test Block", etc.
        // Let's use getByText('Test Block').closest('div[role="button"]')
        const row = screen.getByText('Test Block').closest('div[role="button"]');
        fireEvent.click(row!);
        expect(defaultProps.onSelect).toHaveBeenCalled();
    });

    it('handles status cycle click', () => {
        render(<FlowItemRow {...defaultProps} />);
        const statusDot = screen.getByTitle('Draft');
        fireEvent.click(statusDot);
        expect(defaultProps.onStatusCycle).toHaveBeenCalled();
        expect(defaultProps.onSelect).not.toHaveBeenCalled(); // Stop propagation check
    });

    it('handles menu actions', () => {
        render(<FlowItemRow {...defaultProps} />);

        // Menu is hidden initially
        const menuButton = screen.getByLabelText('More options');
        fireEvent.click(menuButton);

        // Now menu should be visible
        expect(screen.getByText('Duplicate')).toBeInTheDocument();
        expect(screen.getByText('Delete')).toBeInTheDocument();
        expect(screen.getByText('Move up')).toBeInTheDocument();
        expect(screen.getByText('Move down')).toBeInTheDocument();

        // Click Duplicate
        fireEvent.click(screen.getByText('Duplicate'));
        expect(defaultProps.onDuplicate).toHaveBeenCalled();
        expect(defaultProps.onSelect).not.toHaveBeenCalled();

        // Re-open menu
        fireEvent.click(menuButton);
        // Click Delete
        fireEvent.click(screen.getByText('Delete'));
        expect(defaultProps.onDelete).toHaveBeenCalled();
    });

    it('hides move up/down buttons when first/last', () => {
        const { rerender } = render(<FlowItemRow {...defaultProps} isFirst={true} isLast={true} />);
        fireEvent.click(screen.getByLabelText('More options'));

        expect(screen.queryByText('Move up')).not.toBeInTheDocument();
        expect(screen.queryByText('Move down')).not.toBeInTheDocument();
        expect(screen.getByText('Duplicate')).toBeInTheDocument();

        rerender(<FlowItemRow {...defaultProps} isFirst={false} isLast={false} />);
        // Menu is already open, buttons should appear
        expect(screen.getByText('Move up')).toBeInTheDocument();
        expect(screen.getByText('Move down')).toBeInTheDocument();
    });

    it('handles move actions', () => {
        render(<FlowItemRow {...defaultProps} />);

        // Move Up
        fireEvent.click(screen.getByLabelText('More options'));
        fireEvent.click(screen.getByText('Move up'));
        expect(defaultProps.onMoveUp).toHaveBeenCalled();

        // Move Down
        fireEvent.click(screen.getByLabelText('More options')); // Reopen
        fireEvent.click(screen.getByText('Move down'));
        expect(defaultProps.onMoveDown).toHaveBeenCalled();
    });
});
