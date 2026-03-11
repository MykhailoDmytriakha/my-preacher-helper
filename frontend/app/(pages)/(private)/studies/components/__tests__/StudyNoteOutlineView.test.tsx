import { fireEvent, render, screen, within } from '@testing-library/react';

import { StudyNoteOutlineView } from '../StudyNoteOutlineView';
import { StudyNoteOutline } from '../studyNoteOutline';

jest.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: (key: string) => key,
    }),
}));

jest.mock('@components/MarkdownDisplay', () => ({
    __esModule: true,
    default: ({ content }: { content: string }) => <div data-testid="markdown-display">{content}</div>,
}));

jest.mock('@components/HighlightedText', () => ({
    __esModule: true,
    default: ({ text }: { text: string }) => <>{text}</>,
}));

const outlineFixture: StudyNoteOutline = {
    introduction: 'Opening context',
    hasOutline: true,
    totalBranches: 3,
    baseHeadingLevel: 2,
    branches: [
        {
            key: '1',
            path: [1],
            depth: 0,
            headingLevel: 2,
            title: 'Root Branch',
            rawTitle: 'Root Branch',
            body: 'Root body',
            preview: 'Root preview',
            children: [
                {
                    key: '1.1',
                    path: [1, 1],
                    depth: 1,
                    headingLevel: 3,
                    title: 'Child Branch',
                    rawTitle: 'Child Branch',
                    body: 'Child body',
                    preview: 'Child preview',
                    children: [],
                },
            ],
        },
        {
            key: '2',
            path: [2],
            depth: 0,
            headingLevel: 2,
            title: 'Second Root',
            rawTitle: 'Second Root',
            body: '',
            preview: '',
            children: [],
        },
    ],
};

describe('StudyNoteOutlineView', () => {
    const scrollIntoViewMock = jest.fn();
    const originalRequestAnimationFrame = global.requestAnimationFrame;

    beforeEach(() => {
        jest.clearAllMocks();
        Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
            configurable: true,
            value: scrollIntoViewMock,
        });
        global.requestAnimationFrame = ((callback: FrameRequestCallback) => {
            callback(0);
            return 0;
        }) as typeof requestAnimationFrame;
    });

    afterAll(() => {
        global.requestAnimationFrame = originalRequestAnimationFrame;
    });

    it('renders folded previews and forwards outline controls to the parent', () => {
        const onToggleBranch = jest.fn();
        const onExpandAll = jest.fn();
        const onCollapseAll = jest.fn();

        render(
            <StudyNoteOutlineView
                outline={outlineFixture}
                foldedBranchKeys={['1']}
                onToggleBranch={onToggleBranch}
                onExpandAll={onExpandAll}
                onCollapseAll={onCollapseAll}
            />
        );

        expect(screen.getByText('Root preview')).toBeInTheDocument();
        expect(screen.queryByText('Root body')).not.toBeInTheDocument();
        expect(screen.queryByText('Child Branch')).not.toBeInTheDocument();

        fireEvent.click(screen.getByText('studiesWorkspace.expandAll'));
        fireEvent.click(screen.getByText('studiesWorkspace.collapseAll'));
        fireEvent.click(screen.getByTestId('study-note-branch-toggle-1'));

        expect(onExpandAll).toHaveBeenCalledTimes(1);
        expect(onCollapseAll).toHaveBeenCalledTimes(1);
        expect(onToggleBranch).toHaveBeenCalledWith('1');
    });

    it('tracks the active branch through navigator jumps and resets when the branch disappears', () => {
        const { rerender } = render(
            <StudyNoteOutlineView
                outline={outlineFixture}
                foldedBranchKeys={[]}
                onToggleBranch={jest.fn()}
                onExpandAll={jest.fn()}
                onCollapseAll={jest.fn()}
            />
        );

        const navigator = screen.getByRole('navigation');
        const secondBranchButton = within(navigator).getByText('Second Root').closest('button');

        expect(secondBranchButton).not.toBeNull();

        fireEvent.click(secondBranchButton!);

        expect(scrollIntoViewMock).toHaveBeenCalled();
        expect(screen.getByTestId('study-note-branch-2')).toHaveClass('ring-2');

        rerender(
            <StudyNoteOutlineView
                outline={{
                    ...outlineFixture,
                    totalBranches: 2,
                    branches: [outlineFixture.branches[0]],
                }}
                foldedBranchKeys={[]}
                onToggleBranch={jest.fn()}
                onExpandAll={jest.fn()}
                onCollapseAll={jest.fn()}
            />
        );

        expect(screen.getByTestId('study-note-branch-1')).toHaveClass('ring-2');
    });
});
