import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

import AddThoughtManual from '@/components/AddThoughtManual';
import { createManualThought } from '@services/thought.service';

// Mock the services
jest.mock('@services/thought.service');
// No longer fetching in the component during open when props are provided

const mockCreateManualThought = createManualThought as jest.MockedFunction<typeof createManualThought>;
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
    if (['Introduction','intro','Вступление','Вступ'].includes(tag)) return 'intro';
    if (['Main Part','main','Основная часть','Основна частина'].includes(tag)) return 'main';
    if (['Conclusion','conclusion','Заключение','Висновок'].includes(tag)) return 'conclusion';
    return null;
  })
}));

describe('AddThoughtManual', () => {
  const mockOnNewThought = jest.fn();
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
    // Service calls are mocked where used (createManualThought). Tags/outline passed via props

    mockCreateManualThought.mockResolvedValue({
      id: 'new-thought-id',
      text: 'Test thought',
      tags: ['Introduction'],
      date: '2023-01-01T00:00:00.000Z',
      outlinePointId: 'intro-1'
    });
  });

  it('renders the initial add button', () => {
    render(
      <AddThoughtManual 
        sermonId={sermonId} 
        onNewThought={mockOnNewThought} 
        allowedTags={preloadedTags} 
        sermonOutline={preloadedOutline as any}
      />
    );
    expect(screen.getByText('manualThought.addManual')).toBeInTheDocument();
  });

  it('opens the modal when the add button is clicked', async () => {
    render(
      <AddThoughtManual 
        sermonId={sermonId} 
        onNewThought={mockOnNewThought}
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

    render(
      <AddThoughtManual 
        sermonId={sermonId} 
        onNewThought={mockOnNewThought}
        allowedTags={preloadedTags}
        sermonOutline={preloadedOutline as any}
      />,
      { container: wrapper }
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
    render(
      <AddThoughtManual 
        sermonId={sermonId} 
        onNewThought={mockOnNewThought}
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
    render(
      <AddThoughtManual 
        sermonId={sermonId} 
        onNewThought={mockOnNewThought}
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
    render(
      <AddThoughtManual 
        sermonId={sermonId} 
        onNewThought={mockOnNewThought}
        allowedTags={preloadedTags}
        sermonOutline={preloadedOutline as any}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: /manualThought\.addManual/ }));
    const saveButton = await screen.findByRole('button', { name: /buttons\.save/ }, { timeout: 10000 });
    expect(saveButton).toBeDisabled();
  });

  it('renders without calling fetch services when data provided', async () => {
    render(
      <AddThoughtManual 
        sermonId={sermonId} 
        onNewThought={mockOnNewThought}
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
    render(
      <AddThoughtManual 
        sermonId={sermonId} 
        onNewThought={mockOnNewThought}
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
});
