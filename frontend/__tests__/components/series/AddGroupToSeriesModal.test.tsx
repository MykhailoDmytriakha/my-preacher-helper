import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import AddGroupToSeriesModal from '@/components/series/AddGroupToSeriesModal';
import { useGroups } from '@/hooks/useGroups';

jest.mock('@/hooks/useGroups', () => ({
  useGroups: jest.fn(),
}));

jest.mock('@/providers/AuthProvider', () => ({
  useAuth: jest.fn(() => ({ user: { uid: 'user-1' } })),
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string; count?: number }) =>
      options?.defaultValue || (key === 'workspaces.series.actions.selectedCount' ? `Selected ${options?.count}` : key),
  }),
}));

const mockUseGroups = useGroups as jest.MockedFunction<typeof useGroups>;

describe('AddGroupToSeriesModal', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders loading state', () => {
    mockUseGroups.mockReturnValue({
      groups: [],
      loading: true,
    } as any);

    render(
      <AddGroupToSeriesModal
        onClose={jest.fn()}
        onAddGroups={jest.fn()}
        currentSeriesGroupIds={[]}
      />
    );

    expect(screen.getByText('workspaces.series.loadingSeries')).toBeInTheDocument();
  });

  it('filters out already linked groups and adds selected ids', async () => {
    const onClose = jest.fn();
    const onAddGroups = jest.fn().mockResolvedValue(undefined);
    mockUseGroups.mockReturnValue({
      groups: [
        { id: 'g1', title: 'Alpha Group', description: 'Desc', templates: [], flow: [] },
        { id: 'g2', title: 'Beta Group', description: 'Desc', templates: [], flow: [] },
      ],
      loading: false,
    } as any);

    render(
      <AddGroupToSeriesModal
        onClose={onClose}
        onAddGroups={onAddGroups}
        currentSeriesGroupIds={['g1']}
      />
    );

    expect(screen.queryByText('Alpha Group')).not.toBeInTheDocument();
    expect(screen.getByText('Beta Group')).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText('common.search'), { target: { value: 'beta' } });
    fireEvent.click(screen.getByText('Beta Group'));
    expect(screen.getByText('Selected 1')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'workspaces.series.actions.addSelected' }));

    await waitFor(() => expect(onAddGroups).toHaveBeenCalledWith(['g2']));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('shows empty state when no groups are available', () => {
    mockUseGroups.mockReturnValue({
      groups: [],
      loading: false,
    } as any);

    render(
      <AddGroupToSeriesModal
        onClose={jest.fn()}
        onAddGroups={jest.fn()}
        currentSeriesGroupIds={[]}
      />
    );

    expect(screen.getByText('No groups found')).toBeInTheDocument();
  });
});
