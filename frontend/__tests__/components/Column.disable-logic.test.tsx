import { render, screen } from '@testing-library/react';
import React from 'react';
import Column from '../../app/components/Column';
import '@testing-library/jest-dom';

// Constants matching Column.tsx to use in expectations
const DEFAULT_ALL_POINTS_BLOCKED_TEXT = 'All outline points are reviewed';
const DEFAULT_RECORD_AUDIO_TEXT = 'Record voice note';
const DEFAULT_POINT_BLOCKED_TEXT = 'Point is reviewed and blocked';

// Mock dependencies
jest.mock('@heroicons/react/24/outline', () => ({
    MicrophoneIcon: () => <div data-testid="microphone-icon" />,
    PlusIcon: () => <div data-testid="plus-icon" />,
    CheckIcon: () => <div data-testid="check-icon" />,
    ArrowUturnLeftIcon: () => <div data-testid="arrow-uturn-icon" />,
    CommandLineIcon: () => <div data-testid="command-line-icon" />,
    QuestionMarkCircleIcon: () => <div data-testid="question-icon" />,
    PencilIcon: () => <div data-testid="pencil-icon" />,
    XMarkIcon: () => <div data-testid="xmark-icon" />,
    TrashIcon: () => <div data-testid="trash-icon" />,
    Bars3Icon: () => <div data-testid="bars3-icon" />,
    SparklesIcon: () => <div data-testid="sparkles-icon" />,
    ChevronLeftIcon: () => <div data-testid="chevron-left-icon" />,
    ChevronRightIcon: () => <div data-testid="chevron-right-icon" />,
    InformationCircleIcon: () => <div data-testid="info-icon" />,
}));

jest.mock('@/components/Icons', () => ({
    MicrophoneIcon: () => <div data-testid="mic-icon-custom" />,
    SwitchViewIcon: () => <div data-testid="switch-view-icon" />,
}));

jest.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: (key: string, options?: any) => options?.defaultValue || key,
    }),
}));

jest.mock('@dnd-kit/core', () => ({
    useDroppable: () => ({ setNodeRef: jest.fn(), isOver: false }),
}));

jest.mock('@dnd-kit/sortable', () => ({
    SortableContext: ({ children }: any) => <div>{children}</div>,
    verticalListSortingStrategy: jest.fn(),
}));

jest.mock('@hello-pangea/dnd', () => ({
    DragDropContext: ({ children }: any) => <div>{children}</div>,
    Droppable: ({ children }: any) => <div>{children({ innerRef: jest.fn(), droppableProps: {}, placeholder: null })}</div>,
    Draggable: ({ children }: any) => <div>{children({ innerRef: jest.fn(), draggableProps: { style: {} }, dragHandleProps: {} }, { isDragging: false })}</div>,
}));

jest.mock('../../app/components/AudioRecorder', () => ({
    AudioRecorder: ({ disabled }: any) => (
        <div data-testid="audio-recorder" data-disabled={disabled}>AudioRecorder</div>
    ),
}));

jest.mock('../../app/components/FocusRecorderButton', () => ({
    FocusRecorderButton: ({ disabled }: any) => (
        <button data-testid="focus-recorder-button" disabled={disabled}>FocusRecorderButton</button>
    ),
}));

jest.mock('../../app/components/ExportButtons', () => () => <div data-testid="export-buttons" />);
jest.mock('../../app/components/FocusModeLayout', () => ({ content, sidebar }: any) => (
    <div data-testid="focus-layout">
        <div data-testid="sidebar-container">{sidebar}</div>
        <div data-testid="content-container">{content}</div>
    </div>
));
jest.mock('../../app/components/FocusSidebar', () => ({ actions }: any) => (
    <div data-testid="focus-sidebar">
        <div data-testid="sidebar-actions">{actions}</div>
    </div>
));
jest.mock('../../app/components/SortableItem', () => () => <div data-testid="sortable-item" />);
jest.mock('../../app/components/SermonGuidanceTooltips', () => ({
    OutlinePointGuidanceTooltip: () => <div data-testid="outline-tooltip" />,
    SermonSectionGuidanceTooltip: () => <div data-testid="section-tooltip" />,
}));

jest.mock('sonner', () => ({
    toast: { success: jest.fn(), error: jest.fn() }
}));

jest.mock('@/hooks/useOnlineStatus', () => ({ useOnlineStatus: () => true }));
jest.mock('@/utils/debugMode', () => ({ debugLog: jest.fn() }));
jest.mock('@/utils/tagUtils', () => ({ getCanonicalTagForSection: jest.fn() }));
jest.mock('@/services/outline.service', () => ({
    updateSermonOutline: jest.fn(),
    getSermonOutline: jest.fn(),
    generateSermonPointsForSection: jest.fn()
}));

describe('Column Disabling Logic', () => {
    const mockSermonId = 'sermon-1';
    const mockPoint = { id: 'p1', text: 'Point 1', isReviewed: true };
    const mockUnreviewedPoint = { id: 'p2', text: 'Point 2', isReviewed: false };

    describe('SermonPointPlaceholder disabling', () => {
        it('disables Add Thought and FocusRecorderButton when point is reviewed', () => {
            const onAddThought = jest.fn();
            render(
                <Column
                    id="main"
                    title="Main"
                    items={[]}
                    outlinePoints={[mockPoint]}
                    isFocusMode={true}
                    onAddThought={onAddThought}
                    sermonId={mockSermonId}
                />
            );

            // The "Add Manually" button in SermonPointPlaceholder (PlusIcon)
            const plusButton = screen.getByTitle(DEFAULT_POINT_BLOCKED_TEXT);
            expect(plusButton).toBeDisabled();
            expect(plusButton).toHaveClass('cursor-not-allowed');

            // FocusRecorderButton
            const focusRecorder = screen.getByTestId('focus-recorder-button');
            expect(focusRecorder).toBeDisabled();
        });

        it('enables buttons when point is not reviewed', () => {
            render(
                <Column
                    id="main"
                    title="Main"
                    items={[]}
                    outlinePoints={[mockUnreviewedPoint]}
                    isFocusMode={true}
                    onAddThought={jest.fn()}
                    sermonId={mockSermonId}
                />
            );

            const plusButton = screen.queryByTitle(DEFAULT_POINT_BLOCKED_TEXT);
            expect(plusButton).not.toBeInTheDocument();

            const focusRecorder = screen.getByTestId('focus-recorder-button');
            expect(focusRecorder).toBeEnabled();
        });
    });

    describe('Header and Sidebar actions disabling', () => {
        it('disables Mic and Add buttons in normal mode header when all points are blocked', () => {
            render(
                <Column
                    id="main"
                    title="MainPart"
                    items={[]}
                    outlinePoints={[mockPoint]}
                    onAudioThoughtCreated={jest.fn()}
                    onAddThought={jest.fn()}
                    sermonId={mockSermonId}
                />
            );

            const micButton = screen.getByLabelText(DEFAULT_ALL_POINTS_BLOCKED_TEXT);
            const headerButtons = screen.getAllByTitle(DEFAULT_ALL_POINTS_BLOCKED_TEXT);
            const addButton = headerButtons.find(btn => btn.querySelector('[data-testid="plus-icon"]'));

            expect(micButton).toBeDisabled();
            expect(addButton).toBeDisabled();
            expect(micButton).toHaveClass('opacity-50');
        });

        it('disables AudioRecorder in focus sidebar when all points are blocked', () => {
            render(
                <Column
                    id="main"
                    title="Main"
                    items={[]}
                    outlinePoints={[mockPoint]}
                    isFocusMode={true}
                    onAudioThoughtCreated={jest.fn()}
                    sermonId={mockSermonId}
                />
            );

            const audioRecorder = screen.getByTestId('audio-recorder');
            expect(audioRecorder).toHaveAttribute('data-disabled', 'true');
        });

        it('does not disable header buttons if there are no points', () => {
            render(
                <Column
                    id="main"
                    title="MainPart"
                    items={[]}
                    outlinePoints={[]}
                    onAudioThoughtCreated={jest.fn()}
                    onAddThought={jest.fn()}
                    sermonId={mockSermonId}
                />
            );

            const micButton = screen.getByLabelText(DEFAULT_RECORD_AUDIO_TEXT);
            const addButton = screen.getByTitle('structure.addThoughtToSection');

            expect(micButton).toBeEnabled();
            expect(addButton).toBeEnabled();
        });
    });
});
