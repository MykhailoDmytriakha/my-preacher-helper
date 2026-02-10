import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';

import PreachDateList from '@/components/calendar/PreachDateList';
import { usePreachDates } from '@/hooks/usePreachDates';

jest.mock('@/hooks/usePreachDates', () => ({
  usePreachDates: jest.fn(),
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue || key,
    i18n: { language: 'en' },
  }),
}));

jest.mock('date-fns', () => ({
  format: jest.fn((date: Date) => `formatted-${date.toISOString().slice(0, 10)}`),
}));

jest.mock('@/components/calendar/PreachDateModal', () => {
  return function MockPreachDateModal({
    isOpen,
    onClose,
    onSave,
    initialData,
  }: {
    isOpen: boolean;
    onClose: () => void;
    onSave: (data: any) => Promise<void>;
    initialData?: { id?: string } | undefined;
  }) {
    if (!isOpen) return null;
    return (
      <div data-testid="preach-date-modal" data-initial-id={initialData?.id || ''}>
        <button
          onClick={() =>
            onSave({
              date: '2026-03-01',
              status: 'planned',
              church: { id: 'c1', name: 'Saved Church', city: 'City' },
            })
          }
        >
          Save Date
        </button>
        <button onClick={onClose}>Close Modal</button>
      </div>
    );
  };
});

const mockedUsePreachDates = jest.mocked(usePreachDates);

describe('PreachDateList', () => {
  const addDate = jest.fn();
  const updateDate = jest.fn();
  const deleteDate = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    window.confirm = jest.fn().mockReturnValue(true);

    mockedUsePreachDates.mockReturnValue({
      preachDates: [],
      isLoading: false,
      error: null,
      addDate,
      updateDate,
      deleteDate,
      isAdding: false,
      isUpdating: false,
      isDeleting: false,
    });
  });

  it('renders loading skeleton', () => {
    mockedUsePreachDates.mockReturnValue({
      preachDates: [],
      isLoading: true,
      error: null,
      addDate,
      updateDate,
      deleteDate,
      isAdding: false,
      isUpdating: false,
      isDeleting: false,
    });

    const { container } = render(<PreachDateList sermonId="s1" />);

    expect(container.querySelector('.animate-pulse')).toBeInTheDocument();
  });

  it('renders empty state when there are no preach dates', () => {
    render(<PreachDateList sermonId="s1" />);
    expect(screen.getByText('calendar.noPreachDates')).toBeInTheDocument();
  });

  it('renders preach dates with planned/preached badges and fallback raw date', () => {
    mockedUsePreachDates.mockReturnValue({
      preachDates: [
        {
          id: 'pd-preached',
          date: '2026-02-17',
          status: 'preached',
          church: { id: 'c1', name: 'Grace Church', city: 'Kyiv' },
          createdAt: '2026-02-01T00:00:00.000Z',
        },
        {
          id: 'pd-planned-invalid',
          date: 'invalid-date',
          status: 'planned',
          church: { id: 'c2', name: 'Hope Church', city: 'Lviv' },
          audience: 'Youth',
          outcome: 'good',
          createdAt: '2026-02-01T00:00:00.000Z',
        },
      ],
      isLoading: false,
      error: null,
      addDate,
      updateDate,
      deleteDate,
      isAdding: false,
      isUpdating: false,
      isDeleting: false,
    });

    render(<PreachDateList sermonId="s1" />);

    expect(screen.getByText('Preached')).toBeInTheDocument();
    expect(screen.getByText('Planned')).toBeInTheDocument();
    expect(screen.getByText('invalid-date')).toBeInTheDocument();
    expect(screen.getByText('Grace Church')).toBeInTheDocument();
    expect(screen.getByText('Hope Church')).toBeInTheDocument();
    expect(screen.getByText('Youth')).toBeInTheDocument();
    expect(screen.getByText('calendar.outcomes.good')).toBeInTheDocument();
  });

  it('deletes date when confirmed', async () => {
    mockedUsePreachDates.mockReturnValue({
      preachDates: [
        {
          id: 'pd-delete',
          date: '2026-02-17',
          church: { id: 'c1', name: 'Grace Church', city: '' },
          createdAt: '2026-02-01T00:00:00.000Z',
        },
      ],
      isLoading: false,
      error: null,
      addDate,
      updateDate,
      deleteDate,
      isAdding: false,
      isUpdating: false,
      isDeleting: false,
    });

    render(<PreachDateList sermonId="s1" />);

    fireEvent.click(screen.getByTitle('common.delete'));

    await waitFor(() => {
      expect(window.confirm).toHaveBeenCalledWith('calendar.deleteConfirm');
      expect(deleteDate).toHaveBeenCalledWith('pd-delete');
    });
  });

  it('does not delete when confirmation is cancelled', async () => {
    (window.confirm as jest.Mock).mockReturnValue(false);
    mockedUsePreachDates.mockReturnValue({
      preachDates: [
        {
          id: 'pd-delete',
          date: '2026-02-17',
          church: { id: 'c1', name: 'Grace Church', city: '' },
          createdAt: '2026-02-01T00:00:00.000Z',
        },
      ],
      isLoading: false,
      error: null,
      addDate,
      updateDate,
      deleteDate,
      isAdding: false,
      isUpdating: false,
      isDeleting: false,
    });

    render(<PreachDateList sermonId="s1" />);
    fireEvent.click(screen.getByTitle('common.delete'));

    await waitFor(() => {
      expect(deleteDate).not.toHaveBeenCalled();
    });
  });

  it('opens add modal and calls addDate on save', async () => {
    render(<PreachDateList sermonId="s1" />);

    fireEvent.click(screen.getByText('calendar.addPreachDate'));
    expect(screen.getByTestId('preach-date-modal')).toHaveAttribute('data-initial-id', '');

    fireEvent.click(screen.getByText('Save Date'));

    await waitFor(() => {
      expect(addDate).toHaveBeenCalledWith(
        expect.objectContaining({
          date: '2026-03-01',
          status: 'planned',
        })
      );
      expect(updateDate).not.toHaveBeenCalled();
    });
  });

  it('opens edit modal and calls updateDate on save', async () => {
    mockedUsePreachDates.mockReturnValue({
      preachDates: [
        {
          id: 'pd-edit',
          date: '2026-02-17',
          status: 'planned',
          church: { id: 'c1', name: 'Grace Church', city: '' },
          createdAt: '2026-02-01T00:00:00.000Z',
        },
      ],
      isLoading: false,
      error: null,
      addDate,
      updateDate,
      deleteDate,
      isAdding: false,
      isUpdating: false,
      isDeleting: false,
    });

    render(<PreachDateList sermonId="s1" />);

    fireEvent.click(screen.getByTitle('common.edit'));
    expect(screen.getByTestId('preach-date-modal')).toHaveAttribute('data-initial-id', 'pd-edit');

    fireEvent.click(screen.getByText('Save Date'));

    await waitFor(() => {
      expect(updateDate).toHaveBeenCalledWith({
        dateId: 'pd-edit',
        updates: expect.objectContaining({
          date: '2026-03-01',
          status: 'planned',
        }),
      });
      expect(addDate).not.toHaveBeenCalled();
    });
  });
});
