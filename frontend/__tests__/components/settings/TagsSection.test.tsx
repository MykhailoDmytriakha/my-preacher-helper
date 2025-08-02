import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import TagsSection from '@components/settings/TagsSection';
import { Tag } from '@/models/models';
import { User } from 'firebase/auth';
import { getTags, addCustomTag, removeCustomTag, updateTag } from '@/services/tag.service';

// --- Mocks --- //

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

// Mock Tag Services
jest.mock('@/services/tag.service', () => ({
  getTags: jest.fn(),
  addCustomTag: jest.fn(),
  removeCustomTag: jest.fn(),
  updateTag: jest.fn(),
}));

// Mock Child Components (pass down props to simulate interaction)
const mockAddTag = jest.fn();
const mockEditColor = jest.fn();
const mockRemoveTag = jest.fn();
let mockUpdateColor: (color: string) => void = () => {};
let mockCancelColorUpdate: () => void = () => {};

jest.mock('@components/settings/TagList', () => (props: any) => (
  <div data-testid={props.editable ? 'tag-list-editable' : 'tag-list-required'}>
    Mock TagList - Editable: {props.editable ? 'Yes' : 'No'} - Tags: {props.tags.length}
    {props.editable && props.tags.map((tag: Tag) => (
      <div key={tag.id}>
        <span>{tag.name}</span>
        <button onClick={() => props.onEditColor(tag)}>Edit {tag.name}</button>
        <button onClick={() => props.onRemoveTag(tag.name)}>Remove {tag.name}</button>
      </div>
    ))}
  </div>
));

jest.mock('@components/settings/AddTagForm', () => (props: any) => {
  mockAddTag.mockImplementation(props.onAddTag);
  return (
    <div data-testid="add-tag-form">
      Mock AddTagForm
      <button onClick={() => mockAddTag('New Tag from Mock', '#123456')}>Add Mock Tag</button>
    </div>
  );
});

jest.mock('@components/ColorPickerModal', () => (props: any) => {
  mockUpdateColor = props.onOk;
  mockCancelColorUpdate = props.onCancel;
  return (
    <div data-testid="color-picker-modal">
      Mock Color Picker for: {props.tagName}
      <button onClick={() => mockUpdateColor('#FEDCBA')}>Update Color</button>
      <button onClick={mockCancelColorUpdate}>Cancel Update</button>
    </div>
  );
});

// --- Test Data --- //

const mockUser = { uid: 'test-user-123' } as User;

const mockRequiredTags: Tag[] = [
  { id: 'req-1', userId: mockUser.uid, name: 'Intro', color: '#aaa', required: true },
];
const mockCustomTags: Tag[] = [
  { id: 'cust-1', userId: mockUser.uid, name: 'Prayer', color: '#bbb', required: false },
  { id: 'cust-2', userId: mockUser.uid, name: 'Story', color: '#ccc', required: false },
];

const mockInitialTags = { requiredTags: mockRequiredTags, customTags: mockCustomTags };

// --- Test Suite --- //

describe('TagsSection', () => {

  beforeEach(() => {
    jest.clearAllMocks();
    // Setup default mock implementations for services
    (getTags as jest.Mock).mockResolvedValue(mockInitialTags);
    (addCustomTag as jest.Mock).mockResolvedValue(undefined);
    (removeCustomTag as jest.Mock).mockResolvedValue(undefined);
    (updateTag as jest.Mock).mockResolvedValue(undefined);

    // Reset mock component interaction functions
    mockAddTag.mockClear();
    mockEditColor.mockClear();
    mockRemoveTag.mockClear();
    mockUpdateColor = () => {};
    mockCancelColorUpdate = () => {};
  });

  const renderSection = (user: User | null = mockUser) => {
    return render(<TagsSection user={user} />);
  };

  it('fetches tags on mount and renders required and custom lists', async () => {
    renderSection();

    await waitFor(() => {
      expect(getTags).toHaveBeenCalledWith(mockUser.uid);
    });

    // Wait for the component to update with the fetched data
    await waitFor(() => {
      expect(screen.getByTestId('tag-list-required')).toBeInTheDocument();
      expect(screen.getByTestId('tag-list-editable')).toBeInTheDocument();
    });

    // Check content based on mock list rendering
    expect(screen.getByTestId('tag-list-required')).toHaveTextContent(`Tags: ${mockRequiredTags.length}`);
    expect(screen.getByTestId('tag-list-editable')).toHaveTextContent(`Tags: ${mockCustomTags.length}`);
    expect(screen.getByTestId('add-tag-form')).toBeInTheDocument();
  });

  it('calls addCustomTag and refetches tags when AddTagForm calls onAddTag', async () => {
    renderSection();
    await waitFor(() => { // Wait for initial fetch
      expect(getTags).toHaveBeenCalledTimes(1);
    });

    const addMockTagButton = screen.getByRole('button', { name: /Add Mock Tag/i });
    await userEvent.click(addMockTagButton);

    // Check that the callback from AddTagForm was called
    expect(mockAddTag).toHaveBeenCalledWith('New Tag from Mock', '#123456');

    // Check that the service was called within the component's handler
    await waitFor(() => {
      expect(addCustomTag).toHaveBeenCalledTimes(1);
      expect(addCustomTag).toHaveBeenCalledWith(expect.objectContaining({
        name: 'New Tag from Mock',
        color: '#123456',
        userId: mockUser.uid,
        required: false,
      }));
    });

    // Check that tags were refetched
    await waitFor(() => {
      expect(getTags).toHaveBeenCalledTimes(2); // Initial fetch + refetch after add
    });
  });

  it('calls removeCustomTag and refetches tags when editable TagList calls onRemoveTag', async () => {
    renderSection();
    await waitFor(() => { // Wait for initial fetch
      expect(getTags).toHaveBeenCalledTimes(1);
    });

    // Find the remove button within the mock editable list
    const removePrayerButton = screen.getByRole('button', { name: /Remove Prayer/i });
    await userEvent.click(removePrayerButton);

    // Check that the service was called within the component's handler
    await waitFor(() => {
      expect(removeCustomTag).toHaveBeenCalledTimes(1);
      expect(removeCustomTag).toHaveBeenCalledWith(mockUser.uid, 'Prayer');
    });

    // Check that tags were refetched
    await waitFor(() => {
      expect(getTags).toHaveBeenCalledTimes(2); // Initial fetch + refetch after remove
    });
  });

  it('opens ColorPickerModal when editable TagList calls onEditColor', async () => {
    renderSection();
    await waitFor(() => { expect(getTags).toHaveBeenCalledTimes(1); });

    expect(screen.queryByTestId('color-picker-modal')).not.toBeInTheDocument();

    // Find the edit button within the mock editable list
    const editStoryButton = screen.getByRole('button', { name: /Edit Story/i });
    await userEvent.click(editStoryButton);

    // Check if the modal is rendered by the mock
    expect(await screen.findByTestId('color-picker-modal')).toBeInTheDocument();
    expect(screen.getByText(/Mock Color Picker for: Story/i)).toBeInTheDocument();
  });

  it('calls updateTag, refetches tags, and closes modal when color is updated', async () => {
    renderSection();
    await waitFor(() => { expect(getTags).toHaveBeenCalledTimes(1); });

    // 1. Open the modal
    const editStoryButton = screen.getByRole('button', { name: /Edit Story/i });
    await userEvent.click(editStoryButton);
    expect(await screen.findByTestId('color-picker-modal')).toBeInTheDocument();

    // 2. Click the update button in the mock modal
    const updateColorButton = screen.getByRole('button', { name: /Update Color/i });
    await userEvent.click(updateColorButton);

    // 3. Verify updateTag service call
    await waitFor(() => {
      expect(updateTag).toHaveBeenCalledTimes(1);
      expect(updateTag).toHaveBeenCalledWith(expect.objectContaining({
        id: 'cust-2', // Story tag id
        name: 'Story',
        color: '#FEDCBA', // New color from mock modal
      }));
    });

    // 4. Verify tags were refetched
    await waitFor(() => {
      expect(getTags).toHaveBeenCalledTimes(2); // Initial fetch + refetch after update
    });

    // 5. Verify modal closed (check if it's gone)
    expect(screen.queryByTestId('color-picker-modal')).not.toBeInTheDocument();
  });

  it('closes modal when cancel is clicked in ColorPickerModal', async () => {
    renderSection();
    await waitFor(() => { expect(getTags).toHaveBeenCalledTimes(1); });

    // 1. Open the modal
    const editStoryButton = screen.getByRole('button', { name: /Edit Story/i });
    await userEvent.click(editStoryButton);
    expect(await screen.findByTestId('color-picker-modal')).toBeInTheDocument();

    // 2. Click the cancel button in the mock modal
    const cancelUpdateButton = screen.getByRole('button', { name: /Cancel Update/i });
    await userEvent.click(cancelUpdateButton);

    // 3. Verify modal closed
    expect(screen.queryByTestId('color-picker-modal')).not.toBeInTheDocument();

    // 4. Verify updateTag was NOT called
    expect(updateTag).not.toHaveBeenCalled();
     // Verify tags were NOT refetched unnecessarily
     expect(getTags).toHaveBeenCalledTimes(1);
  });

   it('does not fetch tags if user is null', () => {
     renderSection(null);
     expect(getTags).not.toHaveBeenCalled();
   });

}); 