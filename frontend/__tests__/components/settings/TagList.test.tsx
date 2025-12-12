import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';

import '@testing-library/jest-dom';
import { Tag } from '@/models/models';
import TagList from '@components/settings/TagList';

// --- Mocks --- //

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, params?: { name?: string }) => {
        if (key === 'settings.deleteTag' && params?.name) return `Delete ${params.name}`;
        return key; // Simple mock
    },
  }),
}));

// Mock Icons
jest.mock('@components/Icons', () => ({
  TrashIcon: () => <span data-testid="trash-icon">Trash</span>,
  PencilIcon: () => <span data-testid="pencil-icon">Pencil</span>,
}));

// --- Test Data --- //

const mockTags: Tag[] = [
  {
    id: 'tag-1',
    userId: 'user-1',
    name: 'Introduction',
    color: '#FF6B6B',
    required: false,
    translationKey: 'tags.introduction',
  },
  {
    id: 'tag-2',
    userId: 'user-1',
    name: 'Custom Tag',
    color: '#54A0FF',
    required: false,
  },
  {
    id: 'tag-3',
    userId: 'user-1',
    name: 'Main Point',
    color: '#1DD1A1',
    required: true,
  },
];

// --- Test Suite --- //

describe('TagList', () => {
  const mockOnEditColor = jest.fn();
  const mockOnRemoveTag = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  const renderList = (props: Partial<React.ComponentProps<typeof TagList>> = {}) => {
    const defaultProps = {
        tags: mockTags,
        editable: false, // Default to non-editable
        onEditColor: mockOnEditColor,
        onRemoveTag: mockOnRemoveTag,
    };
    return render(<TagList {...defaultProps} {...props} />);
  };

  it('renders the list of tags correctly', () => {
    renderList();
    // Check translated name
    expect(screen.getByText('tags.introduction')).toBeInTheDocument();
    // Check non-translated name
    expect(screen.getByText('Custom Tag')).toBeInTheDocument();
    expect(screen.getByText('Main Point')).toBeInTheDocument();
    // Check colors (via style)
    const colorPreviews = screen.getAllByTestId('tag-color-preview'); // Need to add test-id
    expect(colorPreviews[0]).toHaveStyle('background-color: #FF6B6B');
    expect(colorPreviews[1]).toHaveStyle('background-color: #54A0FF');
    expect(colorPreviews[2]).toHaveStyle('background-color: #1DD1A1');
    // Check hex codes
    expect(screen.getByText('#FF6B6B')).toBeInTheDocument();
    expect(screen.getByText('#54A0FF')).toBeInTheDocument();
    expect(screen.getByText('#1DD1A1')).toBeInTheDocument();
  });

  it('renders the correct message when no tags are provided (editable)', () => {
    renderList({ tags: [], editable: true });
    expect(screen.getByText(/settings.noCustomTags/i)).toBeInTheDocument();
  });

  it('renders the correct message when no tags are provided (not editable)', () => {
    renderList({ tags: [] }); // editable defaults to false
    expect(screen.getByText(/settings.noRequiredTags/i)).toBeInTheDocument();
  });

  it('does not show edit/delete controls when not editable', () => {
    renderList({ editable: false });
    expect(screen.queryByTestId('pencil-icon')).not.toBeInTheDocument();
    expect(screen.queryByTestId('trash-icon')).not.toBeInTheDocument();
    // Color preview should not be clickable
    const colorPreviews = screen.getAllByTestId('tag-color-preview');
    expect(colorPreviews[0]).not.toHaveClass('cursor-pointer');
  });

  it('shows edit/delete controls when editable', () => {
    renderList({ editable: true });
    // Pencil icon should be present (though maybe hidden initially by CSS)
    expect(screen.getAllByTestId('pencil-icon').length).toBe(mockTags.length);
    // Trash icon should be present
    expect(screen.getAllByTestId('trash-icon').length).toBe(mockTags.length);
    // Color preview should be clickable
    const colorPreviews = screen.getAllByTestId('tag-color-preview');
    expect(colorPreviews[0]).toHaveClass('cursor-pointer');
  });

  it('calls onEditColor with correct tag when color preview is clicked (editable)', async () => {
    renderList({ editable: true });
    const colorPreviews = screen.getAllByTestId('tag-color-preview');
    await userEvent.click(colorPreviews[1]); // Click the second tag ('Custom Tag')

    expect(mockOnEditColor).toHaveBeenCalledTimes(1);
    expect(mockOnEditColor).toHaveBeenCalledWith(mockTags[1]);
  });

  it('does not call onEditColor when color preview is clicked (not editable)', async () => {
    renderList({ editable: false });
    const colorPreviews = screen.getAllByTestId('tag-color-preview');
    await userEvent.click(colorPreviews[1]);

    expect(mockOnEditColor).not.toHaveBeenCalled();
  });

  it('calls onRemoveTag with correct tag name when delete button is clicked (editable)', async () => {
    renderList({ editable: true });
    const deleteButtons = screen.getAllByRole('button', { name: /Delete/i }); // Using mock translation
    expect(deleteButtons.length).toBe(mockTags.length);

    await userEvent.click(deleteButtons[2]); // Click delete for the third tag ('Main Point')

    expect(mockOnRemoveTag).toHaveBeenCalledTimes(1);
    expect(mockOnRemoveTag).toHaveBeenCalledWith(mockTags[2].name);
  });

  it('does not call onRemoveTag when delete button does not exist (not editable)', () => {
    renderList({ editable: false });
    expect(screen.queryByRole('button', { name: /Delete/i })).not.toBeInTheDocument();
    // No button to click, so no call expected
    expect(mockOnRemoveTag).not.toHaveBeenCalled();
  });

}); 