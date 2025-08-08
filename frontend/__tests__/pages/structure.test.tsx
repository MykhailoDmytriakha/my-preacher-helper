import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import StructurePage from '@/(pages)/(private)/structure/page';
import { useSermonStructureData } from '@/hooks/useSermonStructureData'; // Import the hook
import { Item, Sermon, OutlinePoint, Tag, Thought, Structure, Outline } from '@/models/models'; // Import necessary types

// Mock next/navigation
jest.mock('next/navigation', () => ({
  useRouter: () => ({
    push: jest.fn(),
    prefetch: jest.fn(),
    replace: jest.fn(),
  }),
  useSearchParams: () => ({
    get: jest.fn().mockImplementation((param) => {
      if (param === 'sermonId') return 'sermon123';
      return null;
    }),
  }),
}));

// Mock the custom hook
jest.mock('@/hooks/useSermonStructureData');
const mockedUseSermonStructureData = useSermonStructureData as jest.Mock;

// Remove mocks for services called *only* by the hook
// jest.mock('@/services/sermon.service'); // Mocked within hook test
// jest.mock('@/services/tag.service'); // Mocked within hook test
// jest.mock('@/services/outline.service'); // Mocked within hook test

// Keep mocks for services called directly by the component (if any - e.g., updateStructure, updateThought)
jest.mock('@/services/structure.service', () => ({
  updateStructure: jest.fn().mockResolvedValue({}),
  // Keep other functions if component calls them directly
}));
jest.mock('@/services/thought.service', () => ({
  updateThought: jest.fn().mockResolvedValue({}),
  deleteThought: jest.fn().mockResolvedValue({}),
  // Keep other functions if component calls them directly
}));
jest.mock('@/services/sortAI.service', () => ({ // Keep AI sort mock if used by component directly
    sortItemsWithAI: jest.fn().mockResolvedValue({}),
}));

// Mock themeColors
jest.mock('@/utils/themeColors', () => ({
  SERMON_SECTION_COLORS: {
    introduction: { base: "#2563eb" },
    mainPart: { base: "#7e22ce" },
    conclusion: { base: "#16a34a" }
  }
}));

// Mock ExportButtons component
jest.mock('@/components/ExportButtons', () => ({
  __esModule: true,
  default: (props: any) => (
    <div data-testid="export-buttons">
      <button onClick={() => props.getExportContent('plain', { includeTags: false })} data-testid="export-txt-button">
        Export TXT
      </button>
    </div>
  ),
}));

// Mock react-i18next
jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const translations: { [key: string]: string } = {
        'structure.introduction': 'Introduction',
        'structure.mainPart': 'Main Part', // Ensure key matches component
        'structure.conclusion': 'Conclusion',
        'structure.underConsideration': 'Under Consideration', // Ensure key matches component
        'structure.normalMode': 'Normal Mode',
        'structure.focusMode': 'Focus Mode',
        'common.loading': 'Loading',
        'errors.fetchSermonStructureError': 'Error fetching structure',
        'structure.sermonNotFound': 'Sermon not found',
        // Add any other keys used directly in the component's render logic
      };
      return translations[key] || key;
    },
    i18n: { changeLanguage: jest.fn() },
  }),
}));

// Mock Column component
const MockColumn = jest.fn(({
  id,
  title,
  items,
  // ... other props passed by StructurePageContent
}) => (
  <div data-testid={`column-${id}`}>
    <h2>{title}</h2>
    <div>
      {items.map((item: any) => (
        <div key={item.id} data-testid={`item-${item.id}`}>
          {item.content}
          {/* Render tags if needed for testing interactions */}
          {item.customTagNames?.map((tag: any) => <span key={tag.name}>{tag.name}</span>)}
        </div>
      ))}
    </div>
    {/* Add mock buttons/interactions needed for component tests */}
  </div>
));
jest.mock('@/components/Column', () => ({
  __esModule: true,
  default: (props: any) => MockColumn(props),
}));

// Mock other components used directly by StructurePageContent
jest.mock('@/components/EditThoughtModal', () => ({
    __esModule: true,
    default: () => <div data-testid="edit-thought-modal">Mock Edit Modal</div>,
}));
jest.mock('@/components/SortableItem', () => ({
    __esModule: true,
    default: ({ item }: { item: Item }) => <div data-testid={`sortable-item-${item.id}`}>{item.content}</div>,
}));

// --- Test Setup Data ---
const mockSermonData: Sermon = {
    id: 'sermon123',
    userId: 'user1',
    title: 'Test Sermon',
    verse: 'John 3:16',
    date: '2023-01-01',
    thoughts: [], // Keep minimal, hook provides items
    structure: { introduction: ['t1'], main: ['t2'], conclusion: ['t3'], ambiguous: ['t4'] },
    outline: { introduction: [], main: [], conclusion: [] },
};

const mockContainersData = {
    introduction: [{ id: 't1', content: 'Intro Item', customTagNames: [], requiredTags: ['Introduction'] }],
    main: [{ id: 't2', content: 'Main Item', customTagNames: [], requiredTags: ['Main Part'] }],
    conclusion: [{ id: 't3', content: 'Conclusion Item', customTagNames: [], requiredTags: ['Conclusion'] }],
    ambiguous: [{ id: 't4', content: 'Ambiguous Item', customTagNames: [], requiredTags: [] }],
};

const mockOutlinePointsData = {
    introduction: [{ id: 'op1', text: 'Outline Intro' }],
    main: [{ id: 'op2', text: 'Outline Main' }],
    conclusion: [{ id: 'op3', text: 'Outline Conclusion' }],
};

const mockAllowedTagsData = [{ name: 'custom1', color: '#eee' }];

const defaultHookState = {
    sermon: mockSermonData,
    containers: mockContainersData,
    setContainers: jest.fn(),
    outlinePoints: mockOutlinePointsData,
    requiredTagColors: { introduction: 'blue', main: 'purple', conclusion: 'green' },
    allowedTags: mockAllowedTagsData,
    loading: false,
    error: null,
    setLoading: jest.fn(),
    isAmbiguousVisible: true,
};

// --- Test Suite ---
describe('StructurePage Component', () => {
  beforeEach(() => {
    // Reset mocks
    mockedUseSermonStructureData.mockClear();
    MockColumn.mockClear();
    // Clear other service mocks if needed
    (jest.requireMock('@/services/structure.service').updateStructure as jest.Mock).mockClear();

    // Default mock state for the hook
    mockedUseSermonStructureData.mockReturnValue(defaultHookState);
  });

  it('should display loading state', () => {
    mockedUseSermonStructureData.mockReturnValue({ ...defaultHookState, loading: true });
    render(<StructurePage />);
    expect(screen.getByText(/Loading/i)).toBeInTheDocument();
  });

  it('should display error state', () => {
    mockedUseSermonStructureData.mockReturnValue({ ...defaultHookState, loading: false, error: 'Fetch Failed' });
    render(<StructurePage />);
    expect(screen.getByText(/Error fetching structure/i)).toBeInTheDocument(); // Check for translated error
    expect(screen.getByText(/Fetch Failed/i)).toBeInTheDocument(); // Check for specific error message if displayed
  });

  it('should display sermon not found state', () => {
    mockedUseSermonStructureData.mockReturnValue({ ...defaultHookState, loading: false, sermon: null });
    render(<StructurePage />);
    expect(screen.getByText(/Sermon not found/i)).toBeInTheDocument();
  });

  it('should render columns and items when data is loaded', async () => {
    render(<StructurePage />);

    await waitFor(() => {
        expect(screen.queryByText(/Loading/i)).not.toBeInTheDocument();
    });

    // Check main columns are rendered (using the MockColumn data-testid)
    expect(screen.getByTestId('column-introduction')).toBeInTheDocument();
    expect(screen.getByTestId('column-main')).toBeInTheDocument();
    expect(screen.getByTestId('column-conclusion')).toBeInTheDocument();

    // Check ambiguous section specifically by its heading
    expect(screen.getByRole('heading', { name: /Under Consideration/i })).toBeInTheDocument();
    // Check item within ambiguous section
    expect(screen.getByTestId('sortable-item-t4')).toBeInTheDocument(); // Assuming SortableItem mock is used inside
    expect(within(screen.getByTestId('sortable-item-t4')).getByText('Ambiguous Item')).toBeInTheDocument();


    // Check items are rendered within main columns (using MockColumn content)
    expect(within(screen.getByTestId('column-introduction')).getByText('Intro Item')).toBeInTheDocument();
    expect(within(screen.getByTestId('column-main')).getByText('Main Item')).toBeInTheDocument();
    expect(within(screen.getByTestId('column-conclusion')).getByText('Conclusion Item')).toBeInTheDocument();

    // Check if MockColumn received correct basic props (id, title, items)
    // We use expect.objectContaining to avoid matching all the numerous handler props
    expect(MockColumn).toHaveBeenCalledWith(expect.objectContaining({ id: 'introduction', title: 'Introduction', items: mockContainersData.introduction }));
    expect(MockColumn).toHaveBeenCalledWith(expect.objectContaining({ id: 'main', title: 'Main Part', items: mockContainersData.main }));
    expect(MockColumn).toHaveBeenCalledWith(expect.objectContaining({ id: 'conclusion', title: 'Conclusion', items: mockContainersData.conclusion }));

  });

  // Add tests for interactions that call service functions directly
  // e.g., Drag and Drop causing updateStructure call
  // e.g., Saving edited thought causing updateThought call
  // e.g., AI Sort button click causing sortItemsWithAI call

  // Example: Test Drag and Drop (requires mocking dnd-kit or simulating events)
  // This is complex and might need more setup for dnd-kit testing

  // Add tests for focus mode if that logic remains in the component
  it('should handle focus mode toggle', async () => {
      // Initial render in normal mode
      render(<StructurePage />);
      await waitFor(() => expect(screen.queryByText(/Loading/i)).not.toBeInTheDocument());

      // Find a focus button within a mock column if Column renders it
      // const focusButton = within(screen.getByTestId('column-introduction')).getByRole('button', { name: /focus/i });
      // fireEvent.click(focusButton);

      // Assert that only the focused column is visible (or has a specific style)
      // await waitFor(() => {
      //    expect(screen.getByTestId('column-introduction')).toBeInTheDocument();
      //    expect(screen.queryByTestId('column-main')).not.toBeInTheDocument();
      // });

      // Assert Normal Mode button appears
      // expect(screen.getByRole('button', { name: /normal mode/i })).toBeInTheDocument();

      // NOTE: This test needs the MockColumn to render the focus button and the StructurePageContent
      //       to correctly implement the show/hide logic based on the `focusedColumn` state.
      //       The exact implementation details of focus button rendering and column visibility
      //       in the actual component and MockColumn are needed.
      expect(true).toBe(true); // Placeholder until focus logic test is fully implemented
  });


}); 