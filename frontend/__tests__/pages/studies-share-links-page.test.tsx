import { render, screen } from '@testing-library/react';
import React from 'react';

import '@testing-library/jest-dom';
import ShareLinksPage from '@/(pages)/(private)/studies/share-links/page';
import { useStudyNotes } from '@/hooks/useStudyNotes';
import { useStudyNoteShareLinks } from '@/hooks/useStudyNoteShareLinks';

jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

jest.mock('@/hooks/useStudyNotes', () => ({
  useStudyNotes: jest.fn(),
}));

jest.mock('@/hooks/useStudyNoteShareLinks', () => ({
  useStudyNoteShareLinks: jest.fn(),
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

const mockUseStudyNotes = useStudyNotes as jest.MockedFunction<typeof useStudyNotes>;
const mockUseStudyNoteShareLinks = useStudyNoteShareLinks as jest.MockedFunction<typeof useStudyNoteShareLinks>;

describe('ShareLinksPage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders header and derived loading state', () => {
    const notes = [
      {
        id: 'note-1',
        userId: 'user-1',
        title: 'Note',
        content: 'Content',
        scriptureRefs: [],
        tags: [],
        createdAt: '2024-01-01',
        updatedAt: '2024-01-02',
        isDraft: false,
      },
    ];
    mockUseStudyNotes.mockReturnValue({ notes, loading: true } as any);
    mockUseStudyNoteShareLinks.mockReturnValue({
      shareLinks: [],
      loading: false,
      createShareLink: jest.fn(),
      deleteShareLink: jest.fn(),
    } as any);

    render(<ShareLinksPage />);

    expect(screen.getByText('studiesWorkspace.shareLinks.manageButton')).toBeInTheDocument();
    expect(screen.getAllByText('studiesWorkspace.shareLinks.subtitle').length).toBeGreaterThan(0);
    expect(screen.getByText('common.back')).toBeInTheDocument();

    expect(screen.getByText('common.loading')).toBeInTheDocument();
  });

  it('renders empty state when data is loaded', () => {
    mockUseStudyNotes.mockReturnValue({ notes: [], loading: false } as any);
    mockUseStudyNoteShareLinks.mockReturnValue({
      shareLinks: [],
      loading: false,
      createShareLink: jest.fn(),
      deleteShareLink: jest.fn(),
    } as any);

    render(<ShareLinksPage />);

    expect(screen.getByText('studiesWorkspace.shareLinks.empty')).toBeInTheDocument();
    expect(screen.queryByText('common.loading')).not.toBeInTheDocument();
  });
});
