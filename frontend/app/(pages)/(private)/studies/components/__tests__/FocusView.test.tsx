import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { StudyNote } from '@/models/models';

import FocusView from '../FocusView';

// Mock createPortal for testing
jest.mock('react-dom', () => ({
  ...jest.requireActual('react-dom'),
  createPortal: (node: React.ReactNode) => node,
}));

const createTestNote = (overrides: Partial<StudyNote> = {}): StudyNote => {
  const timestamp = new Date().toISOString();
  return {
    id: 'note-1',
    userId: 'user-1',
    content: 'This is a test note about grace and faith.',
    title: 'Test Note Title',
    scriptureRefs: [{ id: 'ref-1', book: 'Romans', chapter: 8, fromVerse: 28 }],
    tags: ['grace', 'faith'],
    createdAt: timestamp,
    updatedAt: timestamp,
    isDraft: false,
    ...overrides,
  };
};

describe('FocusView', () => {
  const defaultProps = {
    note: createTestNote(),
    bibleLocale: 'en' as const,
    currentIndex: 0,
    totalCount: 3,
    onClose: jest.fn(),
    onPrev: jest.fn(),
    onNext: jest.fn(),
    hasPrev: false,
    hasNext: true,
    onEdit: jest.fn(),
    onDelete: jest.fn(),
    onAnalyze: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders note title', () => {
    render(<FocusView {...defaultProps} />);

    expect(screen.getByText('Test Note Title')).toBeInTheDocument();
  });

  it('renders note content', () => {
    render(<FocusView {...defaultProps} />);

    expect(screen.getByText(/This is a test note about grace and faith/)).toBeInTheDocument();
  });

  it('renders scripture references', () => {
    render(<FocusView {...defaultProps} />);

    // Check that scripture refs section is rendered
    expect(screen.getByText('studiesWorkspace.scriptureRefs')).toBeInTheDocument();
  });

  it('renders tags', () => {
    render(<FocusView {...defaultProps} />);

    expect(screen.getByText('grace')).toBeInTheDocument();
    expect(screen.getByText('faith')).toBeInTheDocument();
  });

  it('calls onClose when backdrop is clicked', async () => {
    render(<FocusView {...defaultProps} />);

    // Find and click the backdrop (has aria-hidden="true")
    const backdrop = document.querySelector('[aria-hidden="true"]');
    if (backdrop) {
      await userEvent.click(backdrop);
    }

    // onClose is called after animation timeout (200ms)
    await new Promise((resolve) => setTimeout(resolve, 250));
    expect(defaultProps.onClose).toHaveBeenCalled();
  });

  it('calls onEdit when edit button is clicked', async () => {
    render(<FocusView {...defaultProps} />);

    const editButton = screen.getByRole('button', { name: 'common.edit' });
    await userEvent.click(editButton);

    expect(defaultProps.onEdit).toHaveBeenCalledWith(defaultProps.note);
  });

  it('shows question badge when note type is question', () => {
    const questionNote = createTestNote({ type: 'question' });
    render(<FocusView {...defaultProps} note={questionNote} />);

    expect(screen.getByText('studiesWorkspace.type.question')).toBeInTheDocument();
  });

  it('shows keyboard hint on desktop', () => {
    render(<FocusView {...defaultProps} />);

    expect(screen.getByText('studiesWorkspace.focusMode.keyboardHint')).toBeInTheDocument();
  });

  it('renders with untitled fallback when no title', () => {
    const untitledNote = createTestNote({ title: undefined });
    render(<FocusView {...defaultProps} note={untitledNote} />);

    expect(screen.getByText('studiesWorkspace.untitled')).toBeInTheDocument();
  });

  it('shows AI analyze button when note needs analysis', () => {
    const noteNeedsAnalysis = createTestNote({
      title: undefined,
      scriptureRefs: [],
      tags: [],
    });

    render(
      <FocusView
        {...defaultProps}
        note={noteNeedsAnalysis}
        onAnalyze={jest.fn()}
      />
    );

    expect(screen.getByText('studiesWorkspace.aiAnalyze.button')).toBeInTheDocument();
  });

  it('does not show AI analyze button when note has metadata', () => {
    render(<FocusView {...defaultProps} />);

    expect(screen.queryByText('studiesWorkspace.aiAnalyze.button')).not.toBeInTheDocument();
  });
});

