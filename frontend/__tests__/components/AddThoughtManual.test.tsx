import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import AddThoughtManual from '@/components/AddThoughtManual';
import { createManualThought } from '@services/thought.service';
import { getSermonById } from '@services/sermon.service';
import { getTags } from '@services/tag.service';

// Mock the services
jest.mock('@services/thought.service');
jest.mock('@services/sermon.service');
jest.mock('@services/tag.service');

const mockCreateManualThought = createManualThought as jest.MockedFunction<typeof createManualThought>;
const mockGetSermonById = getSermonById as jest.MockedFunction<typeof getSermonById>;
const mockGetTags = getTags as jest.MockedFunction<typeof getTags>;

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
}));

describe('AddThoughtManual', () => {
  const mockOnNewThought = jest.fn();
  const sermonId = 'test-sermon-id';

  beforeEach(() => {
    jest.clearAllMocks();
    
    // Mock successful API responses
    mockGetSermonById.mockResolvedValue({
      id: sermonId,
      title: 'Test Sermon',
      verse: 'Test Verse',
      date: '2023-01-01',
      thoughts: [],
      userId: 'test-user-id',
      outline: {
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
      }
    });

    mockGetTags.mockResolvedValue({
      requiredTags: [
        { id: 'req-1', name: 'Introduction', color: '#ff0000', required: true },
        { id: 'req-2', name: 'Main Part', color: '#00ff00', required: true },
        { id: 'req-3', name: 'Conclusion', color: '#0000ff', required: true }
      ],
      customTags: [
        { id: 'custom-1', name: 'Custom Tag 1', color: '#ffff00', required: false },
        { id: 'custom-2', name: 'Custom Tag 2', color: '#ff00ff', required: false }
      ]
    });

    mockCreateManualThought.mockResolvedValue({
      id: 'new-thought-id',
      text: 'Test thought',
      tags: ['Introduction'],
      date: '2023-01-01T00:00:00.000Z',
      outlinePointId: 'intro-1'
    });
  });

  it('renders the initial add button', () => {
    render(<AddThoughtManual sermonId={sermonId} onNewThought={mockOnNewThought} />);
    expect(screen.getByText('manualThought.addManual')).toBeInTheDocument();
  });

  it('opens the modal when the add button is clicked', async () => {
    render(<AddThoughtManual sermonId={sermonId} onNewThought={mockOnNewThought} />);
    
    fireEvent.click(screen.getByRole('button', { name: /manualThought\.addManual/ }));
    
    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });
  });

  it('shows loading state while fetching data', async () => {
    // Mock a slow response
    mockGetSermonById.mockImplementation(() => new Promise(resolve => setTimeout(resolve, 100)));
    
    render(<AddThoughtManual sermonId={sermonId} onNewThought={mockOnNewThought} />);
    
    fireEvent.click(screen.getByRole('button', { name: /manualThought\.addManual/ }));
    
    // Should show loading spinner
    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });
  });

  it('handles error when loading sermon data', async () => {
    mockGetSermonById.mockRejectedValue(new Error('Failed to load sermon'));
    
    render(<AddThoughtManual sermonId={sermonId} onNewThought={mockOnNewThought} />);
    
    fireEvent.click(screen.getByRole('button', { name: /manualThought\.addManual/ }));
    
    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });
  });

  it('closes the modal when the overlay is clicked', async () => {
    render(<AddThoughtManual sermonId={sermonId} onNewThought={mockOnNewThought} />);
    
    fireEvent.click(screen.getByRole('button', { name: /manualThought\.addManual/ }));
    
    await waitFor(() => {
      const overlay = screen.getByRole('dialog').parentElement;
      expect(overlay).toBeInTheDocument();
    });
    
    const overlay = screen.getByRole('dialog').parentElement;
    fireEvent.click(overlay!);
    
    await waitFor(() => {
      expect(screen.queryByText('buttons.cancel')).not.toBeInTheDocument();
    });
  });

  it('does not submit if text area is empty', async () => {
    render(<AddThoughtManual sermonId={sermonId} onNewThought={mockOnNewThought} />);
    
    fireEvent.click(screen.getByRole('button', { name: /manualThought\.addManual/ }));
    
    await waitFor(() => {
      const saveButton = screen.getByText('buttons.save');
      expect(saveButton).toBeDisabled();
    });
  });
});