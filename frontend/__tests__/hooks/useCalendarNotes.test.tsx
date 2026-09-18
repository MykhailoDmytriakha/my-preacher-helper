import { renderHook } from '@testing-library/react';

import { useCalendarNotes } from '@/hooks/useCalendarNotes';
import { useStudyNotes } from '@/hooks/useStudyNotes';

jest.mock('@/hooks/useStudyNotes', () => ({
  useStudyNotes: jest.fn(),
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const mockUseStudyNotes = jest.mocked(useStudyNotes);

const nameless = {
  id: 'n1',
  userId: 'u1',
  content: 'Девять глав одних имён…',
  scriptureRefs: [],
  tags: [],
  createdAt: '2026-09-03T12:00:00.000Z',
  updatedAt: '2026-09-03T12:00:00.000Z',
  isDraft: false,
};

describe('useCalendarNotes', () => {
  it("translates the section's own notes into calendar entries, naming a nameless one in the app's words", () => {
    mockUseStudyNotes.mockReturnValue({ notes: [nameless], loading: false, error: null } as any);

    const { result } = renderHook(() => useCalendarNotes());

    expect(result.current.entries).toHaveLength(1);
    expect(result.current.entries[0]).toMatchObject({
      kind: 'note',
      refId: 'n1',
      date: '2026-09-03',
      title: 'dashboardHome.sections.studies.untitled',
      href: '/studies/n1',
    });
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it("reports the section's loading as its own, so the month is not drawn half-empty", () => {
    mockUseStudyNotes.mockReturnValue({ notes: [], loading: true, error: null } as any);

    const { result } = renderHook(() => useCalendarNotes());

    expect(result.current).toEqual({ entries: [], isLoading: true, error: null });
  });
});
