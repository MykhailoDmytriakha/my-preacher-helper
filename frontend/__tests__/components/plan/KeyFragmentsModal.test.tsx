import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import KeyFragmentsModal from '@components/plan/KeyFragmentsModal';
import { updateThought } from '@services/thought.service';
import { SermonPoint, Thought } from '@/models/models';
import { toast } from 'sonner';

// --- Mocks --- //

// Mock react-i18next
jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key, // Simple mock
  }),
}));

// Mock sonner toast
jest.mock('sonner', () => ({
  toast: {
    success: jest.fn(),
    error: jest.fn(),
  },
}));

// Mock lucide-react icons (return simple placeholders)
jest.mock('lucide-react', () => ({
  X: () => <span>X</span>,
  Plus: () => <span>+</span>,
  Trash2: () => <span>Trash</span>,
  Lightbulb: () => <span>Lightbulb</span>,
}));

// Mock the thought service
jest.mock('@services/thought.service', () => ({
  updateThought: jest.fn(),
}));

// Mock window.getSelection (basic mock)
const mockGetSelection = jest.fn();
global.window.getSelection = mockGetSelection;

// --- Test Data --- //

const mockSermonPoint: SermonPoint = {
  id: 'op-1',
  text: 'Point 1: Introduction',
};

// Define the initial structure as readonly
const initialMockThoughts: Readonly<Thought[]> = [
  {
    id: 't-1',
    text: 'This is the first thought about the introduction. Select some text here.',
    tags: [],
    date: new Date('2024-01-01T10:00:00Z').toISOString(), // Use fixed date for consistency
    keyFragments: ['first fragment'],
    outlinePointId: 'op-1',
  },
  {
    id: 't-2',
    text: 'Another thought for the intro section. More text to select.',
    tags: [],
    date: new Date('2024-01-01T11:00:00Z').toISOString(), // Use fixed date
    keyFragments: [], // No fragments initially
    outlinePointId: 'op-1',
  },
];

// Declare a mutable version for tests
let mockThoughts: Thought[];

const sermonId = 'sermon-123';

// --- Test Suite --- //

describe('KeyFragmentsModal', () => {
  const mockOnClose = jest.fn();
  const mockOnThoughtUpdate = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    // Reset mock data by deep cloning the initial structure
    mockThoughts = JSON.parse(JSON.stringify(initialMockThoughts));

    // Default mock for getSelection (no selection)
    mockGetSelection.mockReturnValue({
      rangeCount: 0,
      isCollapsed: true,
      getRangeAt: jest.fn(),
      toString: jest.fn().mockReturnValue(''),
    } as unknown as Selection);
    // Mock updateThought to return a new object mimicking the update
    (updateThought as jest.Mock).mockImplementation(async (sId, thought) => {
      // Return a new object to prevent mutation issues and mimic backend response
      return {
        ...thought, // Spread original properties
        id: thought.id, // Ensure id is present
        // Return a *new* array instance based on the input keyFragments
        keyFragments: Array.isArray(thought.keyFragments) ? [...thought.keyFragments] : [], 
      };
    });
  });

  const renderModal = (isOpen = true, thoughts = mockThoughts) => {
    return render(
      <KeyFragmentsModal
        isOpen={isOpen}
        onClose={mockOnClose}
        outlinePoint={mockSermonPoint}
        thoughts={thoughts}
        sermonId={sermonId}
        onThoughtUpdate={mockOnThoughtUpdate}
      />
    );
  };

  it('does not render when isOpen is false', () => {
    const { container } = renderModal(false);
    expect(container.firstChild).toBeNull();
  });

  it('renders correctly when open', () => {
    renderModal();
    expect(screen.getByRole('heading', { name: /plan.keyFragmentsFor: Point 1: Introduction/i })).toBeInTheDocument();
    expect(screen.getByText(mockThoughts[0].text)).toBeInTheDocument();
    expect(screen.getByText(mockThoughts[1].text)).toBeInTheDocument();
    expect(screen.getByText('first fragment')).toBeInTheDocument(); // Existing fragment
    expect(screen.getByRole('button', { name: /X/i })).toBeInTheDocument(); // Close button
    // Check for collapsible instructions
    expect(screen.getByText('plan.howToSelectTextShort')).toBeInTheDocument();
  });

   it('calls onClose when the close button is clicked', async () => {
     renderModal();
     const closeButton = screen.getByRole('button', { name: /X/i });
     await userEvent.click(closeButton);
     expect(mockOnClose).toHaveBeenCalledTimes(1);
   });

   it('calls onClose when Escape key is pressed', () => {
     renderModal();
     fireEvent.keyDown(window, { key: 'Escape', code: 'Escape' });
     expect(mockOnClose).toHaveBeenCalledTimes(1);
   });

   it('renders empty state message when no thoughts are provided', () => {
     renderModal(true, []);
     expect(screen.getByText(/plan.noThoughtsAssigned/i)).toBeInTheDocument();
   });

   it('allows removing an existing fragment', async () => {
     renderModal();
     const fragmentToRemoveText = 'first fragment';
     const removeButton = screen.getByRole('button', { name: /Trash/i }); // Assuming only one trash icon initially

     expect(screen.getByText(fragmentToRemoveText)).toBeInTheDocument();
     expect(removeButton).toBeInTheDocument();

     await userEvent.click(removeButton);

     // Verify updateThought call
     await waitFor(() => {
       expect(updateThought).toHaveBeenCalledTimes(1);
       expect(updateThought).toHaveBeenCalledWith(sermonId, expect.objectContaining({
         id: mockThoughts[0].id,
         keyFragments: [], // Should be empty after removal
       }));
     });

     // Verify UI update and callback
     expect(mockOnThoughtUpdate).toHaveBeenCalledTimes(1);
     expect(mockOnThoughtUpdate).toHaveBeenCalledWith(expect.objectContaining({
       id: mockThoughts[0].id,
       keyFragments: [],
     }));
     expect(toast.success).toHaveBeenCalledWith('plan.fragmentRemoved');

     // Re-render or check state update (element should be gone)
     // For simplicity, let's check if the text is gone after the mocked update returns
     await waitFor(() => {
       expect(screen.queryByText(fragmentToRemoveText)).not.toBeInTheDocument();
     });
   });

   it('can toggle instruction visibility', async () => {
     renderModal();
     
     // Based on the test output, instructions appear to be expanded by default
     // So the detailed tips should be visible initially
     expect(screen.getByText('plan.howToSelectTextShort')).toBeInTheDocument();
     
     // Use a more flexible approach to find the tips
     expect(screen.getByText(/plan\.selectTextTip1/)).toBeInTheDocument();
     expect(screen.getByText(/plan\.selectTextTip2/)).toBeInTheDocument();
     expect(screen.getByText(/plan\.selectTextTip3/)).toBeInTheDocument();
     
     // Click to collapse instructions - find the clickable div with cursor-pointer class
     const instructionsToggle = screen.getByText('plan.howToSelectTextShort').closest('.cursor-pointer');
     expect(instructionsToggle).toBeTruthy();
     await userEvent.click(instructionsToggle!);
     
     // Instructions should now be hidden
     await waitFor(() => {
       expect(screen.queryByText(/plan\.selectTextTip1/)).not.toBeInTheDocument();
     });
     expect(screen.queryByText(/plan\.selectTextTip2/)).not.toBeInTheDocument();
     expect(screen.queryByText(/plan\.selectTextTip3/)).not.toBeInTheDocument();
     
     // Click again to expand
     await userEvent.click(instructionsToggle!);
     
     // Instructions should be visible again
     await waitFor(() => {
       expect(screen.getByText(/plan\.selectTextTip1/)).toBeInTheDocument();
     });
     expect(screen.getByText(/plan\.selectTextTip2/)).toBeInTheDocument();
     expect(screen.getByText(/plan\.selectTextTip3/)).toBeInTheDocument();
   });

   it('handles error when removing a fragment fails', async () => {
     const error = new Error('Update failed');
     (updateThought as jest.Mock).mockRejectedValue(error);

     renderModal();
     const removeButton = screen.getByRole('button', { name: /Trash/i });
     await userEvent.click(removeButton);

     await waitFor(() => {
       expect(updateThought).toHaveBeenCalledTimes(1);
       expect(toast.error).toHaveBeenCalledWith('errors.failedToRemoveFragment');
     });
     expect(mockOnThoughtUpdate).not.toHaveBeenCalled();
     expect(screen.getByText('first fragment')).toBeInTheDocument(); // Fragment still there
   });

    // --- Tests for Adding Fragments (Simulating Selection) --- //

    // Helper to simulate text selection
    const simulateTextSelection = (thoughtId: string, selectedText: string) => {
      // Find the specific div using data-testid
      const thoughtTextDiv = screen.getByTestId(`thought-text-${thoughtId}`);
      if (!thoughtTextDiv) {
        throw new Error(`Could not find thought text div with data-testid thought-text-${thoughtId}`);
      }

      const range = document.createRange();
      // Select contents of the actual text node if possible, or the div
      const textNode = thoughtTextDiv.firstChild;
      if (textNode && textNode.nodeType === Node.TEXT_NODE) {
        // Try to select just the text node content
        range.selectNodeContents(textNode);
      } else {
        // Fallback to selecting the whole div content
        range.selectNodeContents(thoughtTextDiv);
      }

      // Mock the getBoundingClientRect function needed by the component
      const mockGetBoundingClientRect = jest.fn(() => ({
        bottom: 100, top: 80, left: 50, right: 150, width: 100, height: 20, x: 50, y: 80,
        toJSON: () => ({}),
      }));
      range.getBoundingClientRect = mockGetBoundingClientRect;

      const selection = {
        rangeCount: 1,
        isCollapsed: false,
        getRangeAt: jest.fn().mockReturnValue(range),
        toString: jest.fn().mockReturnValue(selectedText),
        commonAncestorContainer: thoughtTextDiv,
      } as unknown as Selection;

      mockGetSelection.mockReturnValue(selection);

      // Trigger mouse up on the container that has the handler
      const container = screen.getByTestId('thoughts-container');
      fireEvent.mouseUp(container);
    };

   it('shows selection popup when text is selected', async () => {
     renderModal();
     const thoughtId = mockThoughts[0].id; // Use the ID of the thought to select from
     const textToSelect = "some text";

     // Simulate text selection on the specific thought
     simulateTextSelection(thoughtId, textToSelect);

     // Wait for the popup to appear (using the new data-testid)
     const popup = await screen.findByTestId('selection-popup');
     expect(popup).toBeInTheDocument();

     // Check if popup button appears
     const addButton = await screen.findByRole('button', { name: /plan.addAsKeyFragment/i });
     expect(addButton).toBeInTheDocument();
     
     // Check the button position based on mocked getBoundingClientRect
     // Top should be bottom + 10 => 100 + 10 = 110px
     // Left should be left => 50px
     expect(popup?.style.top).toBe('110px'); 
     expect(popup?.style.left).toBe('50px'); 
   });

   it('adds a new fragment when add button is clicked after selection', async () => {
     // No need to clone here anymore, as beforeEach resets mockThoughts
     renderModal(true, [mockThoughts[1]]); // Use the second thought from the reset array
     const textToSelect = 'More text';
     const thoughtId = 't-2'; // Matches mockThoughts[1].id

     // Simulate text selection
     simulateTextSelection(thoughtId, textToSelect);

     // Find and click the add button in the popup
     const addButton = await screen.findByRole('button', { name: /plan.addAsKeyFragment/i });
     await userEvent.click(addButton);

     // Wait for the service call
     await waitFor(async () => {
       expect(updateThought).toHaveBeenCalledTimes(1);
       // Get the result returned by the mock implementation
       const updatedThoughtResult = (updateThought as jest.Mock).mock.results[0].value;
       // The updatedThoughtResult is a promise, so await it
       const resolvedThought = await updatedThoughtResult;
       expect(resolvedThought).toEqual(expect.objectContaining({
         id: thoughtId,
         keyFragments: [mockThoughts[1].text],
       }));
     });

     // Verify UI update and callback
     await waitFor(async () => {
        expect(mockOnThoughtUpdate).toHaveBeenCalledTimes(1);
        // Get the result returned by the mock implementation
        const updatedThoughtResult = (updateThought as jest.Mock).mock.results[0].value;
        // The updatedThoughtResult is a promise, so await it
        const resolvedThought = await updatedThoughtResult;
        expect(resolvedThought).toEqual(expect.objectContaining({
          id: thoughtId,
          keyFragments: [mockThoughts[1].text],
        }));
     });

     expect(toast.success).toHaveBeenCalledWith('plan.fragmentAdded');
     // Use queryByTestId to check for absence
     expect(screen.queryByTestId('selection-popup')).not.toBeInTheDocument(); 
   });

   it('handles error when adding a fragment fails', async () => {
     const error = new Error('Update failed');
     (updateThought as jest.Mock).mockRejectedValue(error);

     renderModal(true, [mockThoughts[1]]);
     const thoughtId = mockThoughts[1].id;
     const textToSelect = "Failed text";

     // Simulate text selection
     simulateTextSelection(thoughtId, textToSelect);

     // Click the add button
     const addButton = await screen.findByRole('button', { name: /plan.addAsKeyFragment/i });
     await userEvent.click(addButton);

     await waitFor(() => {
       expect(updateThought).toHaveBeenCalledTimes(1);
       expect(toast.error).toHaveBeenCalledWith('errors.failedToAddFragment');
     });

     expect(mockOnThoughtUpdate).not.toHaveBeenCalled();
      // Use queryByTestId to check for absence
     expect(screen.queryByTestId('selection-popup')).toBeInTheDocument();
   });
}); 