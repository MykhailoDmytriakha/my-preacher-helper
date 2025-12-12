import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';

import '@testing-library/jest-dom';
import SeriesDetailPage from '@/(pages)/(private)/series/[id]/page';

import { TestProviders } from '../../test-utils/test-providers';

// Mock Next.js router
const mockPush = jest.fn();
const mockBack = jest.fn();

jest.mock('next/navigation', () => ({
  useParams: () => ({ id: 'test-series-id' }),
  useRouter: () => ({
    push: mockPush,
    back: mockBack,
  }),
}));

// Mock hooks
jest.mock('@/hooks/useSeriesDetail', () => ({
  useSeriesDetail: () => ({
    series: {
      id: 'test-series-id',
      title: 'Test Series',
      theme: 'Test Theme',
      status: 'active',
      color: '#FF0000',
    },
    sermons: [],
    loading: false,
    error: null,
    addSermon: jest.fn(),
    removeSermon: jest.fn(),
    reorderSeriesSermons: jest.fn(),
    updateSeriesDetail: jest.fn(),
  }),
}));

jest.mock('@/hooks/useSeries', () => ({
  useSeries: () => ({
    deleteExistingSeries: jest.fn(),
  }),
}));

jest.mock('@/providers/AuthProvider', () => ({
  useAuth: () => ({
    user: { uid: 'test-user-id' },
  }),
}));

// Mock icons
jest.mock('@heroicons/react/24/outline', () => ({
  ArrowLeftIcon: () => <div data-testid="arrow-left-icon" />,
  PencilIcon: () => <div data-testid="pencil-icon" />,
  TrashIcon: () => <div data-testid="trash-icon" />,
  PlusIcon: () => <div data-testid="plus-icon" />,
  ExclamationTriangleIcon: () => <div data-testid="exclamation-icon" />,
}));

// Mock i18n
jest.mock('@locales/i18n', () => {}, { virtual: true });
jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

// Mock components
jest.mock('@/components/series/SermonInSeriesCard', () => {
  return function MockSermonInSeriesCard() {
    return <div data-testid="sermon-in-series-card">Sermon Card</div>;
  };
});

jest.mock('@/components/series/EditSeriesModal', () => {
  return function MockEditSeriesModal({ showEditModal }: { showEditModal: boolean }) {
    return showEditModal ? <div data-testid="edit-series-modal">Edit Modal</div> : null;
  };
});

jest.mock('@/components/series/AddSermonToSeriesModal', () => {
  return function MockAddSermonToSeriesModal({ showAddSermonModal }: { showAddSermonModal: boolean }) {
    return showAddSermonModal ? <div data-testid="add-sermon-modal">Add Sermon Modal</div> : null;
  };
});

// Mock sonner
jest.mock('sonner', () => ({
  toast: {
    success: jest.fn(),
    error: jest.fn(),
  },
}));

describe('SeriesDetailPage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders series details correctly', () => {
    render(
      <TestProviders>
        <SeriesDetailPage />
      </TestProviders>
    );

    expect(screen.getByText('Test Series')).toBeInTheDocument();
    expect(screen.getByText('Test Theme')).toBeInTheDocument();
    expect(screen.getAllByText('workspaces.series.form.statuses.active')).toHaveLength(2); // status badge and indicator
  });

  it('navigates to /series when Back to Series button is clicked', () => {
    render(
      <TestProviders>
        <SeriesDetailPage />
      </TestProviders>
    );

    const backButton = screen.getByText('navigation.series');
    fireEvent.click(backButton);

    expect(mockPush).toHaveBeenCalledWith('/series');
    expect(mockBack).not.toHaveBeenCalled();
  });

});
