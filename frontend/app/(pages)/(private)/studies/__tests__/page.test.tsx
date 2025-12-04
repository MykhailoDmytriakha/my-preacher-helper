import { render, screen } from '@testing-library/react';
import StudiesPage from '../page';
import { STUDIES_INPUT_SHARED_CLASSES } from '../constants';
import { useStudyNotes } from '@/hooks/useStudyNotes';

jest.mock('@/hooks/useStudyNotes', () => ({
  useStudyNotes: jest.fn(),
}));

const mockUseStudyNotes = useStudyNotes as jest.MockedFunction<typeof useStudyNotes>;

const baseUseStudyNotesValue = (): ReturnType<typeof useStudyNotes> => ({
  uid: 'mock-user',
  notes: [],
  loading: false,
  error: null,
  refetch: jest.fn(),
  createNote: jest.fn(),
  updating: false,
  updateNote: jest.fn(),
  deleteNote: jest.fn(),
});

describe('StudiesPage', () => {
  beforeEach(() => {
    mockUseStudyNotes.mockReturnValue(baseUseStudyNotesValue());
  });

  it('applies the shared form-field classes to the quick-reference and tag inputs', () => {
    render(<StudiesPage />);

    const quickRefInput = screen.getByPlaceholderText('studiesWorkspace.quickRefPlaceholder');
    const tagInput = screen.getByPlaceholderText('studiesWorkspace.addTag');

    const sharedClasses = STUDIES_INPUT_SHARED_CLASSES.split(' ').filter(Boolean);
    sharedClasses.forEach((className) => {
      expect(quickRefInput).toHaveClass(className);
      expect(tagInput).toHaveClass(className);
    });

    expect(quickRefInput).toHaveClass('w-full');
    expect(tagInput).toHaveClass('w-full', 'min-w-[200px]');
  });
});
