import { render, screen, act, fireEvent } from '@testing-library/react';
import ExegeticalPlanModule from './ExegeticalPlanModule';
import { ExegeticalPlanNode } from '@/models/models';

// Mock child components
jest.mock('./TreeBuilder', () => ({
    __esModule: true,
    default: ({
        _tree,
        onTitleChange,
        onToggleAutoSave,
        autoSaveEnabled,
        onPromote,
        onDemote,
        onRemove,
        onAddChild,
        onAddSibling,
        onAddMainPoint
    }: any) => (
        <div data-testid="tree-builder">
            <button onClick={() => onToggleAutoSave(!autoSaveEnabled)}>
                {autoSaveEnabled ? "Disable Auto-save" : "Enable Auto-save"}
            </button>
            <button onClick={() => onTitleChange('1', 'New Title')}>
                Update Title
            </button>
            <button onClick={() => onPromote('1')}>Promote</button>
            <button onClick={() => onDemote('1')}>Demote</button>
            <button onClick={() => onRemove('1')}>Remove</button>
            <button onClick={() => onAddChild('1')}>Add Child</button>
            <button onClick={() => onAddSibling('1')}>Add Sibling</button>
            <button onClick={() => onAddMainPoint()}>Add Main Point</button>
        </div>
    )
}));

jest.mock('./InstructionSection', () => ({
    __esModule: true,
    default: () => <div />
}));

jest.mock('./AuthorIntentSection', () => ({
    __esModule: true,
    default: () => <div />
}));

jest.mock('./BlockDiagramSection', () => ({
    __esModule: true,
    default: () => <div />
}));

describe('ExegeticalPlanModule', () => {
    const mockOnSave = jest.fn();
    const initialTree: ExegeticalPlanNode[] = [{ id: '1', title: 'Initial', children: [] }];

    beforeEach(() => {
        jest.useFakeTimers();
        mockOnSave.mockClear();
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    it('auto-saves after 15 seconds when title changes', async () => {
        render(
            <ExegeticalPlanModule
                value={initialTree}
                onSave={mockOnSave}
            />
        );

        fireEvent.click(screen.getByText('Update Title'));

        // Fast-forward 14s
        act(() => {
            jest.advanceTimersByTime(14000);
        });
        expect(mockOnSave).not.toHaveBeenCalled();

        // Fast-forward another 2s
        await act(async () => {
            jest.advanceTimersByTime(2000);
        });

        expect(mockOnSave).toHaveBeenCalledTimes(1);
        // The saved tree should have the new title
        const savedTree = mockOnSave.mock.calls[0][0];
        expect(savedTree[0].title).toBe('New Title');
    });

    it('does not auto-save if auto-save is disabled', async () => {
        render(
            <ExegeticalPlanModule
                value={initialTree}
                onSave={mockOnSave}
            />
        );

        fireEvent.click(screen.getByText('Disable Auto-save'));
        fireEvent.click(screen.getByText('Update Title'));

        await act(async () => {
            jest.advanceTimersByTime(20000);
        });

        expect(mockOnSave).not.toHaveBeenCalled();
    });

    it('handles promote/demote handlers', () => {
        render(
            <ExegeticalPlanModule
                value={initialTree}
                onSave={mockOnSave}
            />
        );

        // Promote '1' (root) -> usually does nothing or returns same.
        fireEvent.click(screen.getByText('Promote'));
        fireEvent.click(screen.getByText('Demote'));

        // Add child
        fireEvent.click(screen.getByText('Add Child'));
        // Add sibling
        fireEvent.click(screen.getByText('Add Sibling'));
        // Add main point
        fireEvent.click(screen.getByText('Add Main Point'));
        // Remove
        fireEvent.click(screen.getByText('Remove'));
    });
});
