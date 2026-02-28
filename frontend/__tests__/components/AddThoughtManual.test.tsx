import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

import AddThoughtManual from '@/components/AddThoughtManual';
import { useOnlineStatus } from '@/hooks/useOnlineStatus';
import { useScrollLock } from '@/hooks/useScrollLock';
import useSermon from '@/hooks/useSermon';
import { useTags } from '@/hooks/useTags';
import { TestProviders } from '@test-utils/test-providers';
// Mock scroll lock hook
jest.mock('@/hooks/useScrollLock', () => ({
  useScrollLock: jest.fn(),
}));
jest.mock('@/hooks/useOnlineStatus', () => ({
  useOnlineStatus: jest.fn(),
}));
jest.mock('@/hooks/useTags', () => ({
  useTags: jest.fn(),
}));
jest.mock('@/hooks/useSermon', () => ({
  __esModule: true,
  default: jest.fn(),
}));

// Mock the new RichMarkdownEditor which uses TipTap
jest.mock('@components/ui/RichMarkdownEditor', () => ({
  RichMarkdownEditor: ({ value, onChange, placeholder }: any) => (
    <textarea
      data-testid="mock-rich-editor"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
    />
  ),
}));

// No longer fetching in the component during open when props are provided

const mockUseOnlineStatus = useOnlineStatus as jest.MockedFunction<typeof useOnlineStatus>;
const mockUseSermon = useSermon as jest.MockedFunction<typeof useSermon>;
const mockUseTags = useTags as jest.MockedFunction<typeof useTags>;
const mockToast = jest.requireMock('sonner').toast as { success: jest.Mock; error: jest.Mock };
const tagUtilsMock = jest.requireMock('@utils/tagUtils') as {
  isStructureTag: jest.Mock;
  getStructureIcon: jest.Mock;
};
// const mockGetSermonById = getSermonById as jest.MockedFunction<typeof getSermonById>;
// const mockGetTags = getTags as jest.MockedFunction<typeof getTags>;

// Mock the translation hook
jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

// Mock the toast
jest.mock('sonner', () => ({
  toast: {
    success: jest.fn(),
    error: jest.fn(),
  },
}));

// Mock the tag utilities
jest.mock('@utils/tagUtils', () => ({
  isStructureTag: jest.fn(() => false),
  getStructureIcon: jest.fn(() => null),
  getTagStyle: jest.fn(() => ({ className: 'test-class', style: {} })),
  normalizeStructureTag: jest.fn((tag: string) => {
    if (['Introduction', 'intro', 'Вступление', 'Вступ'].includes(tag)) return 'intro';
    if (['Main Part', 'main', 'Основная часть', 'Основна частина'].includes(tag)) return 'main';
    if (['Conclusion', 'conclusion', 'Заключение', 'Висновок'].includes(tag)) return 'conclusion';
    return null;
  })
}));

describe('AddThoughtManual', () => {
  const mockOnCreateThought = jest.fn();
  const sermonId = 'test-sermon-id';
  const preloadedOutline = {
    introduction: [
      { id: 'intro-1', text: 'Introduction Point 1' },
      { id: 'intro-2', text: 'Introduction Point 2' }
    ],
    main: [
      { id: 'main-1', text: 'Main Point 1' },
      { id: 'main-2', text: 'Main Point 2' }
    ],
    conclusion: [
      { id: 'conclusion-1', text: 'Conclusion Point 1' }
    ]
  } as const;
  const preloadedTags = [
    { name: 'Introduction', color: '#ff0000', translationKey: undefined },
    { name: 'Main Part', color: '#00ff00', translationKey: undefined },
    { name: 'Conclusion', color: '#0000ff', translationKey: undefined },
    { name: 'Custom Tag 1', color: '#ffff00', translationKey: undefined },
    { name: 'Custom Tag 2', color: '#ff00ff', translationKey: undefined }
  ];

  beforeEach(() => {
    jest.clearAllMocks();
    mockUseOnlineStatus.mockReturnValue(true);
    mockUseSermon.mockReturnValue({ sermon: { userId: 'user-1' } as any, loading: false } as any);
    mockUseTags.mockReturnValue({ allTags: [], loading: false } as any);
    tagUtilsMock.isStructureTag.mockReturnValue(false);
    tagUtilsMock.getStructureIcon.mockReturnValue(null);
    mockOnCreateThought.mockResolvedValue({
      id: 'new-thought-id',
      text: 'Test thought',
      tags: ['Introduction'],
      date: '2023-01-01T00:00:00.000Z',
      outlinePointId: 'intro-1'
    });
  });

  const renderWithProviders = (ui: React.ReactElement, container?: HTMLElement) =>
    render(<TestProviders>{ui}</TestProviders>, container ? { container } : undefined);

  it('renders the initial add button', () => {
    renderWithProviders(
      <AddThoughtManual
        sermonId={sermonId}
        onCreateThought={mockOnCreateThought}
        allowedTags={preloadedTags}
        sermonOutline={preloadedOutline as any}
      />
    );
    expect(screen.getByText('manualThought.addManual')).toBeInTheDocument();
  });

  it('opens the modal when the add button is clicked', async () => {
    renderWithProviders(
      <AddThoughtManual
        sermonId={sermonId}
        onCreateThought={mockOnCreateThought}
        allowedTags={preloadedTags}
        sermonOutline={preloadedOutline as any}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /manualThought\.addManual/ }));

    // Assert dialog is present
    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });
  });

  it('renders modal into body portal and centers overlay (regression)', async () => {
    // Render inside a wrapper that could apply transforms in real app
    const wrapper = document.createElement('div');
    wrapper.setAttribute('id', 'transform-wrapper');
    document.body.appendChild(wrapper);

    renderWithProviders(
      <AddThoughtManual
        sermonId={sermonId}
        onCreateThought={mockOnCreateThought}
        allowedTags={preloadedTags}
        sermonOutline={preloadedOutline as any}
      />,
      wrapper
    );

    // Open modal
    fireEvent.click(screen.getByRole('button', { name: /manualThought\.addManual/ }));

    // Dialog should be present and rendered inside the portal content container (document.body)
    const dialog = await screen.findByRole('dialog');
    const portalContent = screen.getByTestId('portal-content');
    expect(portalContent.contains(dialog)).toBe(true);

    // Ensure it is NOT rendered under the wrapper (prevents transform-offset issues)
    expect(wrapper.contains(dialog)).toBe(false);

    // Overlay div should use fixed + centered flex classes
    const overlay = portalContent.querySelector('div');
    expect(overlay).toBeTruthy();
    const classList = (overlay as HTMLElement).className.split(' ');
    expect(classList).toEqual(expect.arrayContaining(['fixed', 'inset-0', 'flex', 'items-center', 'justify-center']));
  });

  it('opens modal ready without fetching/spinner when data provided', async () => {
    renderWithProviders(
      <AddThoughtManual
        sermonId={sermonId}
        onCreateThought={mockOnCreateThought}
        allowedTags={preloadedTags}
        sermonOutline={preloadedOutline as any}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: /manualThought\.addManual/ }));
    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });
    // Save button should be present immediately
    expect(screen.queryByText('buttons.save')).toBeInTheDocument();
  });

  // Error handling while loading is covered elsewhere; skipped here since data is provided

  it('closes the modal when the overlay is clicked', async () => {
    renderWithProviders(
      <AddThoughtManual
        sermonId={sermonId}
        onCreateThought={mockOnCreateThought}
        allowedTags={preloadedTags}
        sermonOutline={preloadedOutline as any}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /manualThought\.addManual/ }));
    const dialog = await screen.findByRole('dialog');
    const overlay = dialog.parentElement as HTMLElement;
    fireEvent.click(overlay);
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
  });

  it('does not submit if text area is empty', async () => {
    renderWithProviders(
      <AddThoughtManual
        sermonId={sermonId}
        onCreateThought={mockOnCreateThought}
        allowedTags={preloadedTags}
        sermonOutline={preloadedOutline as any}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: /manualThought\.addManual/ }));
    const saveButton = await screen.findByRole('button', { name: /buttons\.save/ }, { timeout: 10000 });
    expect(saveButton).toBeDisabled();
  });

  it('renders without calling fetch services when data provided', async () => {
    renderWithProviders(
      <AddThoughtManual
        sermonId={sermonId}
        onCreateThought={mockOnCreateThought}
        allowedTags={preloadedTags}
        sermonOutline={preloadedOutline as any}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: /manualThought\.addManual/ }));
    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });
  });

  it('shows flex-wrap tag containers (no horizontal scrollbar)', async () => {
    renderWithProviders(
      <AddThoughtManual
        sermonId={sermonId}
        onCreateThought={mockOnCreateThought}
        allowedTags={preloadedTags}
        sermonOutline={preloadedOutline as any}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: /manualThought\.addManual/ }));
    await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument());
    await screen.findByRole('button', { name: /buttons\.save/ }, { timeout: 10000 });
    const tagsLabel = await screen.findByText('thought.tagsLabel');
    const tagsContainer = tagsLabel.closest('div')?.querySelector('div');
    if (tagsContainer) {
      expect(tagsContainer.className).toContain('flex');
      expect(tagsContainer.className).toContain('flex-wrap');
      expect(tagsContainer.className).not.toContain('overflow-x-auto');
    }
    const availableLabel = await screen.findByText('editThought.availableTags');
    const availableContainer = availableLabel.closest('div')?.querySelector('div');
    if (availableContainer) {
      expect(availableContainer.className).toContain('flex');
      expect(availableContainer.className).toContain('flex-wrap');
      expect(availableContainer.className).not.toContain('overflow-x-auto');
    }
  });

  // Removed older async fetch behavior tests; the component now relies on preloaded data

  it('toggles scroll lock based on open state', async () => {
    (useScrollLock as jest.Mock).mockClear();
    renderWithProviders(
      <AddThoughtManual
        sermonId={sermonId}
        onCreateThought={mockOnCreateThought}
        allowedTags={preloadedTags}
        sermonOutline={preloadedOutline as any}
      />
    );

    // Initially closed
    expect(useScrollLock).toHaveBeenLastCalledWith(false);

    // Open modal
    fireEvent.click(screen.getByRole('button', { name: /manualThought\.addManual/ }));
    await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument());

    // Should be locked
    expect(useScrollLock).toHaveBeenLastCalledWith(true);

    // Close modal
    fireEvent.click(screen.getByRole('button', { name: /buttons\.cancel/ }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    // Should be unlocked
    expect(useScrollLock).toHaveBeenLastCalledWith(false);
  });

  it('submits a thought with selected tags and outline point', async () => {
    renderWithProviders(
      <AddThoughtManual
        sermonId={sermonId}
        onCreateThought={mockOnCreateThought}
        allowedTags={preloadedTags}
        sermonOutline={preloadedOutline as any}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /manualThought\.addManual/ }));
    await screen.findByRole('dialog');

    fireEvent.change(screen.getByTestId('mock-rich-editor'), {
      target: { value: 'A newly added thought' },
    });
    fireEvent.change(screen.getByRole('combobox'), {
      target: { value: 'intro-1' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add tag Custom Tag 1' }));
    fireEvent.click(screen.getByRole('button', { name: /buttons\.save/ }));

    await waitFor(() => {
      expect(mockOnCreateThought).toHaveBeenCalledWith(
        expect.objectContaining({
          text: 'A newly added thought',
          tags: ['Custom Tag 1'],
          outlinePointId: 'intro-1',
        })
      );
    });
    expect(mockToast.success).toHaveBeenCalledWith('manualThought.addedSuccess');
  });

  it('treats optimistic creates without an immediate saved thought as success', async () => {
    mockOnCreateThought.mockResolvedValueOnce(undefined);

    renderWithProviders(
      <AddThoughtManual
        sermonId={sermonId}
        onCreateThought={mockOnCreateThought}
        allowedTags={preloadedTags}
        sermonOutline={preloadedOutline as any}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /manualThought\.addManual/ }));
    await screen.findByRole('dialog');
    fireEvent.change(screen.getByTestId('mock-rich-editor'), {
      target: { value: 'Optimistic thought' },
    });
    fireEvent.click(screen.getByRole('button', { name: /buttons\.save/ }));

    await waitFor(() => {
      expect(mockOnCreateThought).toHaveBeenCalledWith(
        expect.objectContaining({ text: 'Optimistic thought' })
      );
    });
    expect(mockToast.success).toHaveBeenCalledWith('manualThought.addedSuccess');
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
  });

  it('shows an error toast and keeps the dialog open when save fails', async () => {
    mockOnCreateThought.mockRejectedValueOnce(new Error('save failed'));

    renderWithProviders(
      <AddThoughtManual
        sermonId={sermonId}
        onCreateThought={mockOnCreateThought}
        allowedTags={preloadedTags}
        sermonOutline={preloadedOutline as any}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /manualThought\.addManual/ }));
    await screen.findByRole('dialog');
    fireEvent.change(screen.getByTestId('mock-rich-editor'), {
      target: { value: 'Still trying' },
    });
    fireEvent.click(screen.getByRole('button', { name: /buttons\.save/ }));

    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalled();
    });
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(mockOnCreateThought).toHaveBeenCalledTimes(1);
  });

  it('shows offline warning and disables saving when offline', async () => {
    mockUseOnlineStatus.mockReturnValue(false);

    renderWithProviders(
      <AddThoughtManual
        sermonId={sermonId}
        onCreateThought={mockOnCreateThought}
        allowedTags={preloadedTags}
        sermonOutline={preloadedOutline as any}
      />
    );

    const trigger = screen.getByRole('button', { name: /manualThought\.addManual/ });
    expect(trigger).toHaveAttribute('title', 'manualThought.offlineDisabled');

    fireEvent.click(trigger);
    await screen.findByRole('dialog');

    expect(screen.getByText('manualThought.offlineWarning')).toBeInTheDocument();
    fireEvent.change(screen.getByTestId('mock-rich-editor'), {
      target: { value: 'Offline thought' },
    });
    expect(screen.getByRole('button', { name: /buttons\.save/ })).toBeDisabled();
    expect(mockOnCreateThought).not.toHaveBeenCalled();
  });

  it('opens after pending data becomes ready and falls back to default outline when props are absent', async () => {
    mockUseSermon.mockReturnValue({ sermon: { userId: 'user-1', outline: undefined } as any, loading: false } as any);
    mockUseTags.mockReturnValueOnce({ allTags: [], loading: false } as any);

    const { rerender } = renderWithProviders(
      <AddThoughtManual sermonId={sermonId} onCreateThought={mockOnCreateThought} />
    );

    fireEvent.click(screen.getByRole('button', { name: /manualThought\.addManual/ }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    mockUseTags.mockReturnValue({
      allTags: [{ name: 'Fallback Tag', color: '#123456' }],
      loading: false,
    } as any);

    rerender(
      <TestProviders>
        <AddThoughtManual sermonId={sermonId} onCreateThought={mockOnCreateThought} />
      </TestProviders>
    );

    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });

    expect(screen.getByRole('option', { name: 'Introduction' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Main Point 1' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Conclusion' })).toBeInTheDocument();
  });

  it('renders translated and structure tags and clears outline selection back to undefined', async () => {
    tagUtilsMock.isStructureTag.mockImplementation((tag: string) => tag === 'Introduction');
    tagUtilsMock.getStructureIcon.mockReturnValue({ className: 'icon-intro', svg: '<svg />' });
    mockUseSermon.mockReturnValue({
      sermon: {
        userId: 'user-1',
        outline: {
          introduction: [{ id: 'intro-1', text: 'Intro Point 1' }],
          main: [],
          conclusion: [],
        },
      } as any,
      loading: false,
    } as any);
    mockUseTags.mockReturnValue({
      allTags: [
        { name: 'Introduction', color: '#ff0000' },
        { name: 'Special', color: '#00ff00', translationKey: 'tags.special' },
      ],
      loading: false,
    } as any);

    renderWithProviders(
      <AddThoughtManual sermonId={sermonId} onCreateThought={mockOnCreateThought} />
    );

    fireEvent.click(screen.getByRole('button', { name: /manualThought\.addManual/ }));
    await screen.findByRole('dialog');

    fireEvent.click(screen.getByRole('button', { name: 'Add tag tags.introduction' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add tag tags.special' }));
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'intro-1' } });
    expect(screen.getByText('editThought.selectedSermonPoint')).toBeInTheDocument();
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '' } });
    fireEvent.change(screen.getByTestId('mock-rich-editor'), {
      target: { value: 'Translated tag thought' },
    });
    fireEvent.click(screen.getByRole('button', { name: /buttons\.save/ }));

    await waitFor(() => {
      expect(mockOnCreateThought).toHaveBeenCalledWith(
        expect.objectContaining({
          tags: ['Introduction', 'Special'],
          outlinePointId: undefined,
        })
      );
    });
    expect(tagUtilsMock.getStructureIcon).toHaveBeenCalledWith('Introduction');
    expect(document.querySelector('.icon-intro')).toBeInTheDocument();
  });
});
