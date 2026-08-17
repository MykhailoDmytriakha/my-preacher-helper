import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

import '@testing-library/jest-dom';
import OptionMenu from '@/components/dashboard/OptionMenu';
import { persistedWrite } from '@/utils/recoverableWrite';
import { Sermon } from '@/models/models';
import { deleteSermon, updateSermon } from '@services/sermon.service';
import * as preachDatesService from '@services/preachDates.service';

// Mock dependencies
jest.mock('@services/sermon.service', () => ({
  deleteSermon: jest.fn().mockResolvedValue({}),
  updateSermon: jest.fn().mockResolvedValue({}),
}));

jest.mock('@services/preachDates.service', () => ({
  addPreachDate: jest.fn().mockResolvedValue({}),
  updatePreachDate: jest.fn().mockResolvedValue({}),
  deletePreachDate: jest.fn().mockResolvedValue({}),
}));

const mockRouterRefresh = jest.fn();
jest.mock('next/navigation', () => ({
  useRouter: () => ({
    refresh: mockRouterRefresh,
  }),
}));

const mockInvalidateQueries = jest.fn();
const mockSetQueryData = jest.fn();
jest.mock('@tanstack/react-query', () => ({
  useQuery: jest.fn(() => ({
    data: [],
    isLoading: false,
    error: null,
  })),
  useQueryClient: () => ({
    invalidateQueries: mockInvalidateQueries,
    // The source-note writer merges its one field into the cached list and pairs that with an
    // invalidate; without these the stub client throws the moment a link is saved.
    setQueryData: mockSetQueryData,
    cancelQueries: jest.fn().mockResolvedValue(undefined),
  }),
}));

// The playlist membership sweep hook (used for series add/move/remove) internally
// calls useMutation — stub it so this test's partial react-query mock is enough.
/**
 * The picker's own list comes from the notes cache, which this suite has no QueryClient for.
 * Only the READ is stubbed — the writer under test stays real, because it is the thing these
 * tests are about.
 */
jest.mock('@/hooks/useSermonNoteLinks', () => {
  const actual = jest.requireActual('@/hooks/useSermonNoteLinks');
  return {
    ...actual,
    useStudyNoteDirectory: () => ({
      notes: [
        {
          id: 'note-2',
          userId: 'user-1',
          title: 'A note to tick',
          content: '',
          tags: [],
          scriptureRefs: [],
          isDraft: false,
          createdAt: '2026-08-01T00:00:00.000Z',
          updatedAt: '2026-08-01T00:00:00.000Z',
        },
      ],
      loading: false,
      // A known-good list: only then may an unresolved link be shown as "deleted".
      ready: true,
    }),
  };
});

jest.mock('@/providers/AuthProvider', () => ({
  useAuth: () => ({ user: { uid: 'user-1' }, loading: false }),
}));

jest.mock('@/hooks/useSeriesMembership', () => ({
  useSeriesMembership: () => ({
    addToSeries: jest.fn(),
    addRefsToSeries: jest.fn(),
    removeFromAllSeries: jest.fn(),
    reorderSeries: jest.fn(),
  }),
}));

// Mock the Icons component
jest.mock('@components/Icons', () => ({
  DotsVerticalIcon: () => <div data-testid="dots-vertical-icon" />,
}));

// Mock the EditSermonModal component
jest.mock('@components/EditSermonModal', () => {
  return function MockEditSermonModal({ 
    onClose, 
    onUpdate, 
    sermon 
  }: { 
    onClose: () => void; 
    onUpdate: (sermon: Sermon) => void; 
    sermon: Sermon 
  }) {
    return (
      <div data-testid="edit-sermon-modal">
        <button onClick={() => onClose()}>Close</button>
        <button onClick={() => onUpdate({ ...sermon, title: 'Updated Sermon' })}>Update</button>
      </div>
    );
  };
});

jest.mock('@components/calendar/PreachDateModal', () => {
  return function MockPreachDateModal({
    isOpen,
    onClose,
    onSave,
    initialData,
  }: {
    isOpen: boolean;
    onClose: () => void;
    onSave: (data: any) => Promise<void>;
    initialData?: any;
  }) {
    if (!isOpen) return null;
    return (
      <div
        data-testid="preach-date-modal"
        data-initial-church-id={initialData?.church?.id || ''}
        data-initial-church-name={initialData?.church?.name || ''}
      >
        <button
          onClick={() =>
            onSave({
              date: '2024-01-21',
              church: { id: 'c1', name: 'Test Church', city: 'City' },
              audience: 'Youth'
            })
          }
        >
          Save Date
        </button>
        <button onClick={onClose}>Close Date</button>
      </div>
    );
  };
});

// Mock the entire i18n module
jest.mock('@locales/i18n', () => {}, { virtual: true });

// Mock the useTranslation hook
jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const translations: { [key: string]: string } = {
        'optionMenu.options': 'Options',
        'optionMenu.edit': 'Edit',
        'optionMenu.delete': 'Delete',
        'optionMenu.deleteConfirm': 'Are you sure you want to delete this sermon?',
        'optionMenu.deleteError': 'Error deleting sermon',
      };
      
      return translations[key] || key;
    },
    // The source-note picker resolves Bible book names from the active language.
    i18n: { language: 'en' },
  }),
}));

describe('OptionMenu Component', () => {
  // Default mock sermon
  const mockSermon: Sermon = {
    id: 'sermon-1',
    title: 'Test Sermon',
    verse: 'John 3:16',
    date: '2023-01-01',
    thoughts: [],
    userId: 'user-1', // Add the required userId property
  };
  
  const defaultProps = {
    sermon: mockSermon,
    onDelete: jest.fn(),
    onUpdate: jest.fn(),
  };

  const buildOptimisticActions = (overrides: Record<string, jest.Mock> = {}) => ({
    createSermon: jest.fn(() => ({ ...persistedWrite(Promise.resolve()), sermonId: 'created-sermon' })),
    saveEditedSermon: jest.fn(() => persistedWrite(Promise.resolve())),
    deleteSermon: jest.fn(() => persistedWrite(Promise.resolve())),
    markAsPreachedFromPreferred: jest.fn(() => persistedWrite(Promise.resolve())),
    unmarkAsPreached: jest.fn(() => persistedWrite(Promise.resolve())),
    savePreachDate: jest.fn(() => persistedWrite(Promise.resolve())),
    retrySync: jest.fn().mockResolvedValue(undefined),
    dismissSyncError: jest.fn(),
    ...overrides,
  });
  
  beforeEach(() => {
    jest.clearAllMocks();
    // Mock window.confirm to always return true
    window.confirm = jest.fn().mockImplementation(() => true);
    mockRouterRefresh.mockReset();
  });
  
  /**
   * THE WIRING, not the picker: these two assert that the menu really offers the source-note
   * action and really mounts the dialog. Without them the whole feature could be deleted from
   * this menu while every component and hook test stayed green — which is exactly what an
   * adversarial review pointed out.
   */
  it('offers "link a note" when the sermon has none, and opens the picker', () => {
    render(<OptionMenu {...defaultProps} />);
    fireEvent.click(screen.getByTestId('dots-vertical-icon').closest('button') as HTMLElement);

    const action = screen.getByText('sermon.sourceNotes.menuAdd');
    fireEvent.click(action);

    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('offers "change linked notes" once the sermon names one', () => {
    render(<OptionMenu {...defaultProps} sermon={{ ...mockSermon, sourceNoteIds: ['note-1'] }} />);
    fireEvent.click(screen.getByTestId('dots-vertical-icon').closest('button') as HTMLElement);

    expect(screen.getByText('sermon.sourceNotes.menuEdit')).toBeInTheDocument();
    expect(screen.queryByText('sermon.sourceNotes.menuAdd')).not.toBeInTheDocument();
  });

  it('re-arms the proof after a refusal, so a deliberate second press can win', async () => {
    // Found in the browser, not by a unit test: adopting the server's LIST is only half the
    // exit. The second press must also vouch for something the server recognises, or the same
    // click is refused for ever — a dead end dressed as a safety feature.
    const { StaleWriteError } = jest.requireActual('@/services/conflictSafeUpdate.client');
    (updateSermon as jest.Mock)
      .mockRejectedValueOnce(new StaleWriteError('core', 3, 9, { sourceNoteIds: ['from-phone'] }))
      .mockResolvedValueOnce({ ...mockSermon, sourceNoteIds: ['from-phone', 'mine'] });

    render(
      <OptionMenu {...defaultProps} sermon={{ ...mockSermon, sourceNoteIds: ['mine'], rev: { core: 3 } }} />
    );
    fireEvent.click(screen.getByTestId('dots-vertical-icon').closest('button') as HTMLElement);
    fireEvent.click(screen.getByText('sermon.sourceNotes.menuEdit'));

    // Tick another note, or there is nothing to save and the writer is skipped by design.
    fireEvent.click(
      (screen.getByText('A note to tick').closest('label') as HTMLElement).querySelector('input') as HTMLElement
    );
    fireEvent.click(screen.getByText('sermon.sourceNotes.picker.save'));
    await waitFor(() => expect(updateSermon).toHaveBeenCalledTimes(1));
    // First press vouched for what the dialog opened with.
    expect((updateSermon as jest.Mock).mock.calls[0][3]).toEqual({ sourceNoteIds: ['mine'] });

    // The dialog now shows the server's list; tick one more and press again.
    const deadRow = screen.getByTestId('missing-note-row');
    expect(deadRow).toBeInTheDocument();
    // The dialog stays LOCKED until the refusal has fully settled — that is the fix for
    // "dismissable/editable mid-save", so the test has to wait for it rather than race it.
    const box = () =>
      (screen.getByText('A note to tick').closest('label') as HTMLElement).querySelector(
        'input'
      ) as HTMLInputElement;
    await waitFor(() => expect(box()).toBeEnabled());

    fireEvent.click(box());
    fireEvent.click(screen.getByText('sermon.sourceNotes.picker.save'));

    await waitFor(() => expect(updateSermon).toHaveBeenCalledTimes(2));
    const second = (updateSermon as jest.Mock).mock.calls[1];
    expect(second[2]).toBe(9); // the revision the refusal reported
    expect(second[3]).toEqual({ sourceNoteIds: ['from-phone'] }); // what the server actually holds

    // `mockClear` in beforeEach does not drop queued once-implementations, so restore the
    // suite's default rather than leaving a rejection behind for the next test.
    (updateSermon as jest.Mock).mockReset();
    (updateSermon as jest.Mock).mockResolvedValue({});
  });

  it('keeps the opening proof even if the sermon underneath refreshes while the picker is open', async () => {
    // The picker holds the ticks it opened with; if the proof were re-read from the refreshed
    // prop, the guard would bless overwriting whatever the other device just stored. No test
    // covered this seam before an adversarial review pointed it out.
    (updateSermon as jest.Mock).mockResolvedValue({});
    const opened = { ...mockSermon, sourceNoteIds: ['mine'], rev: { core: 3 } };

    const { rerender } = render(<OptionMenu {...defaultProps} sermon={opened} />);
    fireEvent.click(screen.getByTestId('dots-vertical-icon').closest('button') as HTMLElement);
    fireEvent.click(screen.getByText('sermon.sourceNotes.menuEdit'));

    // Another device's write arrives and the page re-renders underneath the open dialog.
    rerender(
      <OptionMenu
        {...defaultProps}
        sermon={{ ...mockSermon, sourceNoteIds: ['from-phone'], rev: { core: 9 } }}
      />
    );

    fireEvent.click(
      (screen.getByText('A note to tick').closest('label') as HTMLElement).querySelector('input') as HTMLElement
    );
    fireEvent.click(screen.getByText('sermon.sourceNotes.picker.save'));

    await waitFor(() => expect(updateSermon).toHaveBeenCalledTimes(1));
    const call = (updateSermon as jest.Mock).mock.calls[0];
    expect(call[2]).toBe(3); // revision at OPEN, not the refreshed 9
    expect(call[3]).toEqual({ sourceNoteIds: ['mine'] }); // list at OPEN
    (updateSermon as jest.Mock).mockReset();
    (updateSermon as jest.Mock).mockResolvedValue({});
  });

  it('still writes when the person toggles away and back to the same set', async () => {
    // "Same as when I opened it" is not "nothing to do": the server may have moved meanwhile, so
    // a deliberate choice must reach it. Without `force` this press would be swallowed.
    (updateSermon as jest.Mock).mockResolvedValue({});
    render(
      <OptionMenu {...defaultProps} sermon={{ ...mockSermon, sourceNoteIds: ['note-2'], rev: { core: 3 } }} />
    );
    fireEvent.click(screen.getByTestId('dots-vertical-icon').closest('button') as HTMLElement);
    fireEvent.click(screen.getByText('sermon.sourceNotes.menuEdit'));

    const box = () =>
      (screen.getByText('A note to tick').closest('label') as HTMLElement).querySelector(
        'input'
      ) as HTMLElement;
    // Re-queried each time: the row re-renders between clicks, and a node captured once can be
    // detached by then — a click on it silently does nothing.
    fireEvent.click(box()); // untick
    fireEvent.click(box()); // tick again — back to the opening set
    fireEvent.click(screen.getByText('sermon.sourceNotes.picker.save'));

    await waitFor(() => expect(updateSermon).toHaveBeenCalledTimes(1));
    expect((updateSermon as jest.Mock).mock.calls[0][1]).toEqual({ sourceNoteIds: ['note-2'] });
    (updateSermon as jest.Mock).mockReset();
    (updateSermon as jest.Mock).mockResolvedValue({});
  });

  it('keeps the copy it was given whole — a link save must not drop detail-only fields', async () => {
    // The last P1 of the review loop: a design that chose between a "newer" list copy and a
    // fuller detail copy by one counter could drop `scratch`/`thoughts` from the screen. The menu
    // now applies a PATCH to the copy its own screen handed it, so there is nothing to choose.
    (updateSermon as jest.Mock).mockResolvedValue({ ...mockSermon, sourceNoteIds: ['note-2'] });
    const onUpdate = jest.fn();
    const fullCopy = {
      ...mockSermon,
      sourceNoteIds: [],
      rev: { core: 3 },
      scratch: [{ id: 'sc1', text: 'only the detail copy has this', createdAt: '2026-08-16' }],
    } as Sermon;

    render(<OptionMenu {...defaultProps} onUpdate={onUpdate} sermon={fullCopy} />);
    fireEvent.click(screen.getByTestId('dots-vertical-icon').closest('button') as HTMLElement);
    fireEvent.click(screen.getByText('sermon.sourceNotes.menuAdd'));
    fireEvent.click(
      (screen.getByText('A note to tick').closest('label') as HTMLElement).querySelector('input') as HTMLElement
    );
    fireEvent.click(screen.getByText('sermon.sourceNotes.picker.save'));

    await waitFor(() => expect(onUpdate).toHaveBeenCalled());
    const published = onUpdate.mock.calls[0][0] as Sermon;
    expect(published.sourceNoteIds).toEqual(['note-2']);
    expect(published.scratch).toHaveLength(1);
    (updateSermon as jest.Mock).mockReset();
    (updateSermon as jest.Mock).mockResolvedValue({});
  });

  it('renders correctly with the menu button', () => {
    render(<OptionMenu {...defaultProps} />);
    
    // Check the menu button is rendered
    expect(screen.getByTestId('dots-vertical-icon')).toBeInTheDocument();
  });
  
  it('shows options when menu is clicked', () => {
    render(<OptionMenu {...defaultProps} />);
    
    // Click the menu button
    fireEvent.click(screen.getByRole('button', { name: 'Options' }));
    
    // Check options are displayed
    expect(screen.getByText('Edit')).toBeInTheDocument();
    expect(screen.getByText('Delete')).toBeInTheDocument();
  });
  
  it('hides menu when clicked outside', () => {
    render(
      <div>
        <div data-testid="outside">Outside</div>
        <OptionMenu {...defaultProps} />
      </div>
    );
    
    // Open the menu
    fireEvent.click(screen.getByRole('button', { name: 'Options' }));
    
    // Ensure menu is open
    expect(screen.getByText('Edit')).toBeInTheDocument();
    
    // Click outside
    fireEvent.click(screen.getByTestId('outside'));
    
    // Menu should close
    expect(screen.queryByText('Edit')).not.toBeInTheDocument();
  });
  
  it('opens edit modal when Edit button is clicked', () => {
    render(<OptionMenu {...defaultProps} />);
    
    // Open the menu
    fireEvent.click(screen.getByRole('button', { name: 'Options' }));
    
    // Click Edit
    fireEvent.click(screen.getByText('Edit'));
    
    // Check modal is shown
    expect(screen.getByTestId('edit-sermon-modal')).toBeInTheDocument();
  });
  
  it('calls onUpdate with updated sermon when sermon is updated', () => {
    render(<OptionMenu {...defaultProps} />);
    
    // Open the menu
    fireEvent.click(screen.getByRole('button', { name: 'Options' }));
    
    // Click Edit
    fireEvent.click(screen.getByText('Edit'));
    
    // Click Update in modal
    fireEvent.click(screen.getByText('Update'));
    
    // Check onUpdate was called
    expect(defaultProps.onUpdate).toHaveBeenCalledTimes(1);
    expect(defaultProps.onUpdate).toHaveBeenCalledWith({ 
      ...mockSermon, 
      title: 'Updated Sermon' 
    });
  });
  
  it('closes edit modal when Close button is clicked', () => {
    render(<OptionMenu {...defaultProps} />);
    
    // Open the menu
    fireEvent.click(screen.getByRole('button', { name: 'Options' }));
    
    // Click Edit
    fireEvent.click(screen.getByText('Edit'));
    
    // Modal should be open
    expect(screen.getByTestId('edit-sermon-modal')).toBeInTheDocument();
    
    // Click Close in modal
    fireEvent.click(screen.getByText('Close'));
    
    // Modal should close
    expect(screen.queryByTestId('edit-sermon-modal')).not.toBeInTheDocument();
  });
  
  it('calls onDelete with sermon ID when Delete is clicked and confirmed', async () => {
    // Mock deleteSermon to resolve immediately so we can await it
    (deleteSermon as jest.Mock).mockImplementation(async () => {
      return Promise.resolve({});
    });
    
    render(<OptionMenu {...defaultProps} />);
    
    // Open the menu
    fireEvent.click(screen.getByRole('button', { name: 'Options' }));
    
    // Click Delete
    fireEvent.click(screen.getByText('Delete'));
    
    // Check confirm was called
    expect(window.confirm).toHaveBeenCalledWith('Are you sure you want to delete this sermon?');
    
    // Check deleteSermon service was called
    expect(deleteSermon).toHaveBeenCalledWith('sermon-1');
    
    // Wait for async operations to complete
    await new Promise(resolve => setTimeout(resolve, 0));
    
    // Check onDelete was called
    expect(defaultProps.onDelete).toHaveBeenCalledWith('sermon-1');
  });
  
  it('keeps dates but downgrades them to planned when unmarking preached sermon', async () => {
    const mockOnDelete = jest.fn();
    const mockOnUpdate = jest.fn();

    // Clear mocks before test
    mockInvalidateQueries.mockClear();

    const preachedSermon = {
      ...mockSermon,
      isPreached: true,
      preachDates: [
        { id: 'pd1', date: '2024-01-15', church: { id: 'c1', name: 'Test Church', city: 'City' }, createdAt: '2024-01-01T00:00:00Z' },
        { id: 'pd2', date: '2024-01-20', church: { id: 'c2', name: 'Another Church', city: 'City2' }, createdAt: '2024-01-01T00:00:00Z' }
      ]
    };

    render(
      <OptionMenu
        sermon={preachedSermon}
        onDelete={mockOnDelete}
        onUpdate={mockOnUpdate}
      />
    );

    // Open menu and click unmark button
    fireEvent.click(screen.getByRole('button'));
    fireEvent.click(screen.getByText('optionMenu.markAsNotPreached'));

    // Verify preached dates were downgraded (not deleted)
    await waitFor(() => {
      expect(preachDatesService.updatePreachDate).toHaveBeenCalledWith('sermon-1', 'pd1', { status: 'planned' });
      expect(preachDatesService.updatePreachDate).toHaveBeenCalledWith('sermon-1', 'pd2', { status: 'planned' });
    });

    // Verify sermon was updated with isPreached: false (dates stay in DB)
    await waitFor(() => {
      expect(updateSermon).toHaveBeenCalledWith(
        { ...preachedSermon, isPreached: false },
        { isPreached: false }
      );
    });

    // Verify cache invalidation
    await waitFor(() => {
      expect(mockInvalidateQueries).toHaveBeenCalledWith({
        queryKey: ['calendarSermons'],
        exact: false
      });
    });
  });

  it('marks sermon as preached using existing planned date without opening modal', async () => {
    const plannedSermon: Sermon = {
      ...mockSermon,
      isPreached: false,
      preachDates: [
        {
          id: 'pd-plan',
          date: '2026-03-10',
          status: 'planned',
          church: { id: 'c1', name: 'Test Church', city: 'City' },
          createdAt: '2026-02-01T00:00:00Z'
        }
      ]
    };

    render(
      <OptionMenu
        sermon={plannedSermon}
        onDelete={jest.fn()}
        onUpdate={jest.fn()}
      />
    );

    // Open menu and click mark as preached
    fireEvent.click(screen.getByRole('button'));
    fireEvent.click(screen.getByText('optionMenu.markAsPreached'));

    await waitFor(() => {
      expect(preachDatesService.updatePreachDate).toHaveBeenCalledWith('sermon-1', 'pd-plan', { status: 'preached' });
      expect(updateSermon).toHaveBeenCalledWith(
        { ...plannedSermon, isPreached: true },
        { isPreached: true }
      );
    });

    expect(screen.queryByTestId('preach-date-modal')).not.toBeInTheDocument();
    expect(mockInvalidateQueries).toHaveBeenCalledWith({
      queryKey: ['calendarSermons'],
      exact: false
    });
  });

  it('opens modal to collect details when planned date has unspecified church', async () => {
    const plannedSermon: Sermon = {
      ...mockSermon,
      isPreached: false,
      preachDates: [
        {
          id: 'pd-plan-unspecified',
          date: '2026-03-10',
          status: 'planned',
          church: { id: 'church-unspecified', name: 'Church not specified', city: '' },
          createdAt: '2026-02-01T00:00:00Z'
        }
      ]
    };

    render(
      <OptionMenu
        sermon={plannedSermon}
        onDelete={jest.fn()}
        onUpdate={jest.fn()}
      />
    );

    fireEvent.click(screen.getByRole('button'));
    fireEvent.click(screen.getByText('optionMenu.markAsPreached'));

    expect(screen.getByTestId('preach-date-modal')).toBeInTheDocument();
    expect(screen.getByTestId('preach-date-modal')).toHaveAttribute('data-initial-church-id', '');
    expect(screen.getByTestId('preach-date-modal')).toHaveAttribute('data-initial-church-name', '');

    fireEvent.click(screen.getByText('Save Date'));

    await waitFor(() => {
      expect(preachDatesService.updatePreachDate).toHaveBeenCalledWith(
        'sermon-1',
        'pd-plan-unspecified',
        expect.objectContaining({
          status: 'preached',
          church: expect.objectContaining({ name: 'Test Church' }),
          audience: 'Youth'
        })
      );
      expect(preachDatesService.addPreachDate).not.toHaveBeenCalled();
      expect(updateSermon).toHaveBeenCalledWith(
        { ...plannedSermon, isPreached: true },
        { isPreached: true }
      );
    });
  });

  it('opens preached modal when preferred date has empty church name', async () => {
    const sermonWithMissingChurchName: Sermon = {
      ...mockSermon,
      preachDates: [
        {
          id: 'pd-empty-name',
          date: '2026-03-11',
          status: 'planned',
          church: { id: 'c1', name: '   ', city: '' },
          createdAt: '2026-02-01T00:00:00Z',
        },
      ],
    };

    render(
      <OptionMenu
        sermon={sermonWithMissingChurchName}
        onDelete={jest.fn()}
        onUpdate={jest.fn()}
      />
    );

    fireEvent.click(screen.getByRole('button'));
    fireEvent.click(screen.getByText('optionMenu.markAsPreached'));

    expect(screen.getByTestId('preach-date-modal')).toBeInTheDocument();
    expect(screen.getByTestId('preach-date-modal')).toHaveAttribute('data-initial-church-id', 'c1');
  });

  it('uses router refresh when onUpdate is not provided', async () => {
    const plannedSermon: Sermon = {
      ...mockSermon,
      isPreached: false,
      preachDates: [
        {
          id: 'pd-plan',
          date: '2026-03-10',
          status: 'planned',
          church: { id: 'c1', name: 'Test Church', city: 'City' },
          createdAt: '2026-02-01T00:00:00Z'
        }
      ]
    };

    render(<OptionMenu sermon={plannedSermon} />);

    fireEvent.click(screen.getByRole('button'));
    fireEvent.click(screen.getByText('optionMenu.markAsPreached'));

    await waitFor(() => {
      expect(preachDatesService.updatePreachDate).toHaveBeenCalledWith('sermon-1', 'pd-plan', { status: 'preached' });
      expect(mockRouterRefresh).toHaveBeenCalled();
    });
  });

  it('opens modal and adds preached date when no date exists', async () => {
    render(
      <OptionMenu
        sermon={mockSermon}
        onDelete={jest.fn()}
        onUpdate={jest.fn()}
      />
    );

    fireEvent.click(screen.getByRole('button'));
    fireEvent.click(screen.getByText('optionMenu.markAsPreached'));

    expect(screen.getByTestId('preach-date-modal')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Save Date'));

    await waitFor(() => {
      expect(preachDatesService.addPreachDate).toHaveBeenCalledWith('sermon-1', expect.objectContaining({
        status: 'preached'
      }));
      expect(updateSermon).toHaveBeenCalledWith(
        { ...mockSermon, isPreached: true },
        { isPreached: true }
      );
    });
  });

  it('does not delete sermon when confirmation is canceled', async () => {
    // Mock confirm to return false this time
    window.confirm = jest.fn().mockImplementation(() => false);
    
    render(<OptionMenu {...defaultProps} />);
    
    // Open the menu
    fireEvent.click(screen.getByRole('button', { name: 'Options' }));
    
    // Click Delete
    fireEvent.click(screen.getByText('Delete'));
    
    // Check deleteSermon service was not called
    expect(deleteSermon).not.toHaveBeenCalled();
    
    // Check onDelete was not called
    expect(defaultProps.onDelete).not.toHaveBeenCalled();
  });

  it('uses optimistic delete action when provided', async () => {
    const optimisticActions = buildOptimisticActions();

    render(
      <OptionMenu
        {...defaultProps}
        optimisticActions={optimisticActions}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Options' }));
    fireEvent.click(screen.getByText('Delete'));

    await waitFor(() => {
      expect(optimisticActions.deleteSermon).toHaveBeenCalledWith(mockSermon);
    });

    expect(deleteSermon).not.toHaveBeenCalled();
  });

  it('uses optimistic mark action for planned preferred date', async () => {
    const optimisticActions = buildOptimisticActions();
    const plannedSermon: Sermon = {
      ...mockSermon,
      preachDates: [
        {
          id: 'pd-plan-optimistic',
          date: '2026-07-10',
          status: 'planned',
          church: { id: 'c1', name: 'Test Church', city: 'City' },
          createdAt: '2026-01-01T00:00:00.000Z',
        },
      ],
    };

    render(
      <OptionMenu
        sermon={plannedSermon}
        optimisticActions={optimisticActions}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Options' }));
    fireEvent.click(screen.getByText('optionMenu.markAsPreached'));

    await waitFor(() => {
      expect(optimisticActions.markAsPreachedFromPreferred).toHaveBeenCalledWith(
        plannedSermon,
        expect.objectContaining({ id: 'pd-plan-optimistic' })
      );
    });

    expect(preachDatesService.updatePreachDate).not.toHaveBeenCalledWith(
      'sermon-1',
      'pd-plan-optimistic',
      expect.objectContaining({ status: 'preached' })
    );
  });

  it('uses optimistic unmark action for preached sermon', async () => {
    const optimisticActions = buildOptimisticActions();
    const preachedSermon: Sermon = {
      ...mockSermon,
      isPreached: true,
      preachDates: [
        {
          id: 'pd-preached',
          date: '2026-07-10',
          status: 'preached',
          church: { id: 'c1', name: 'Test Church', city: 'City' },
          createdAt: '2026-01-01T00:00:00.000Z',
        },
      ],
    };

    render(
      <OptionMenu
        sermon={preachedSermon}
        optimisticActions={optimisticActions}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Options' }));
    fireEvent.click(screen.getByText('optionMenu.markAsNotPreached'));

    await waitFor(() => {
      expect(optimisticActions.unmarkAsPreached).toHaveBeenCalledWith(preachedSermon);
    });

    expect(updateSermon).not.toHaveBeenCalledWith(expect.objectContaining({ isPreached: false }));
  });

  it('uses optimistic savePreachDate action from modal flow', async () => {
    const optimisticActions = buildOptimisticActions();

    render(
      <OptionMenu
        sermon={mockSermon}
        optimisticActions={optimisticActions}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Options' }));
    fireEvent.click(screen.getByText('optionMenu.markAsPreached'));

    expect(screen.getByTestId('preach-date-modal')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Save Date'));

    await waitFor(() => {
      expect(optimisticActions.savePreachDate).toHaveBeenCalledWith(
        mockSermon,
        expect.objectContaining({
          date: '2024-01-21',
          church: expect.objectContaining({ name: 'Test Church' }),
          audience: 'Youth',
        }),
        null
      );
    });

    expect(preachDatesService.addPreachDate).not.toHaveBeenCalled();
  });

  it('disables menu interactions while sync is pending', () => {
    render(
      <OptionMenu
        {...defaultProps}
        syncState={{ status: 'pending', operation: 'update' }}
      />
    );

    const menuButton = screen.getByRole('button', { name: 'Options' });
    expect(menuButton).toBeDisabled();
  });

  it('leaves an optimistic mark refusal to the row badge and only closes the menu', async () => {
    /**
     * The badge on the sermon row reads the same failed mutation and reports it with the
     * operation, a retry and a dismiss. An `alert` on top of that was the same refusal
     * told twice — and the second telling offered no recovery, just an interruption.
     */
    const alertSpy = jest.spyOn(window, 'alert').mockImplementation(() => {});
    const optimisticActions = buildOptimisticActions({
      markAsPreachedFromPreferred: jest.fn(() => persistedWrite(Promise.reject(new Error('mark failed')))),
    });
    const plannedSermon: Sermon = {
      ...mockSermon,
      preachDates: [
        {
          id: 'pd-plan-error',
          date: '2026-08-01',
          status: 'planned',
          church: { id: 'c1', name: 'Test Church', city: 'City' },
          createdAt: '2026-01-01T00:00:00.000Z',
        },
      ],
    };

    render(
      <OptionMenu
        sermon={plannedSermon}
        optimisticActions={optimisticActions}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Options' }));
    fireEvent.click(screen.getByText('optionMenu.markAsPreached'));

    await waitFor(() => {
      expect(screen.queryByText('Delete')).not.toBeInTheDocument();
    });

    expect(alertSpy).not.toHaveBeenCalled();
    alertSpy.mockRestore();
  });

  it('DOES speak when there is no optimistic row to speak for it', async () => {
    // The fallback path writes straight through `updateSermon`: no mutation, no badge,
    // nobody else. Silence here would be the original defect — a person pressing a menu
    // item, nothing happening, and no reason given.
    const alertSpy = jest.spyOn(window, 'alert').mockImplementation(() => {});
    (updateSermon as jest.Mock).mockRejectedValueOnce(new Error('unmark failed'));

    render(<OptionMenu {...defaultProps} sermon={{ ...mockSermon, isPreached: true }} />);

    fireEvent.click(screen.getByRole('button', { name: 'Options' }));
    fireEvent.click(screen.getByText('optionMenu.markAsNotPreached'));

    await waitFor(() => expect(alertSpy).toHaveBeenCalledWith('optionMenu.updateError'));
    alertSpy.mockRestore();
  });
});
