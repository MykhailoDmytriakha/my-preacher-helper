import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { useSearchParams, useRouter, usePathname } from 'next/navigation';
import StructurePage from '@/(pages)/(private)/structure/page';
import { useSermonStructureData } from '@/hooks/useSermonStructureData';
import { toast } from 'sonner';

// Mock dependencies
jest.mock('next/navigation', () => ({
  useSearchParams: jest.fn(),
  useRouter: jest.fn(),
  usePathname: jest.fn(),
}));

jest.mock('@/hooks/useSermonStructureData');
jest.mock('sonner');

// Mock the EditThoughtModal component
jest.mock('@/components/EditThoughtModal', () => {
  return function MockEditThoughtModal({ onSave, onClose }: any) {
    return (
      <div data-testid="edit-thought-modal">
        <button onClick={() => onSave('Test thought', ['tag1'], 'outline-1')}>
          Save
        </button>
        <button onClick={onClose}>Close</button>
      </div>
    );
  };
});

// Mock the Column component
jest.mock('@/components/Column', () => {
  return function MockColumn({ id, title, onAddThought }: any) {
    return (
      <div data-testid={`column-${id}`}>
        <h3>{title}</h3>
        <button 
          onClick={() => onAddThought(id)}
          data-testid={`add-thought-button-${id}`}
        >
          +
        </button>
      </div>
    );
  };
});

const mockUseSermonStructureData = useSermonStructureData as jest.MockedFunction<typeof useSermonStructureData>;
const mockUseSearchParams = useSearchParams as jest.MockedFunction<typeof useSearchParams>;
const mockUseRouter = useRouter as jest.MockedFunction<typeof useRouter>;
const mockUsePathname = usePathname as jest.MockedFunction<typeof usePathname>;

describe('StructurePage Plus Button Functionality', () => {
  const mockSermon = {
    id: 'sermon-1',
    title: 'Test Sermon',
    thoughts: [],
    structure: {
      introduction: [],
      main: [],
      conclusion: [],
      ambiguous: []
    },
    outline: {
      introduction: [{ id: 'outline-1', text: 'Intro Point' }],
      main: [{ id: 'outline-2', text: 'Main Point' }],
      conclusion: [{ id: 'outline-3', text: 'Conclusion Point' }]
    }
  };

  const mockContainers = {
    introduction: [],
    main: [],
    conclusion: [],
    ambiguous: []
  };

  const mockOutlinePoints = {
    introduction: [{ id: 'outline-1', text: 'Intro Point' }],
    main: [{ id: 'outline-2', text: 'Main Point' }],
    conclusion: [{ id: 'outline-3', text: 'Conclusion Point' }]
  };

  const mockAllowedTags = [
    { name: 'tag1', color: '#ff0000' },
    { name: 'tag2', color: '#00ff00' }
  ];

  beforeEach(() => {
    mockUseSearchParams.mockReturnValue({
      get: jest.fn((key) => {
        if (key === 'sermonId') return 'sermon-1';
        if (key === 'mode') return null;
        if (key === 'section') return null;
        return null;
      }),
      toString: jest.fn(() => 'sermonId=sermon-1'),
    } as any);

    mockUseRouter.mockReturnValue({
      push: jest.fn(),
      replace: jest.fn(),
      refresh: jest.fn(),
    } as any);

    mockUsePathname.mockReturnValue('/structure');

    mockUseSermonStructureData.mockReturnValue({
      sermon: mockSermon,
      setSermon: jest.fn(),
      containers: mockContainers,
      setContainers: jest.fn(),
      outlinePoints: mockOutlinePoints,
      requiredTagColors: {},
      allowedTags: mockAllowedTags,
      loading: false,
      error: null,
      setLoading: jest.fn(),
      isAmbiguousVisible: false,
      setIsAmbiguousVisible: jest.fn(),
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should render plus buttons in all columns', () => {
    render(<StructurePage />);
    
    expect(screen.getByTestId('add-thought-button-introduction')).toBeInTheDocument();
    expect(screen.getByTestId('add-thought-button-main')).toBeInTheDocument();
    expect(screen.getByTestId('add-thought-button-conclusion')).toBeInTheDocument();
  });

  it('should open edit modal when plus button is clicked in introduction column', async () => {
    render(<StructurePage />);
    
    const addButton = screen.getByTestId('add-thought-button-introduction');
    fireEvent.click(addButton);
    
    await waitFor(() => {
      expect(screen.getByTestId('edit-thought-modal')).toBeInTheDocument();
    });
  });

  it('should open edit modal when plus button is clicked in main column', async () => {
    render(<StructurePage />);
    
    const addButton = screen.getByTestId('add-thought-button-main');
    fireEvent.click(addButton);
    
    await waitFor(() => {
      expect(screen.getByTestId('edit-thought-modal')).toBeInTheDocument();
    });
  });

  it('should open edit modal when plus button is clicked in conclusion column', async () => {
    render(<StructurePage />);
    
    const addButton = screen.getByTestId('add-thought-button-conclusion');
    fireEvent.click(addButton);
    
    await waitFor(() => {
      expect(screen.getByTestId('edit-thought-modal')).toBeInTheDocument();
    });
  });

  it('should handle saving a new thought from the modal', async () => {
    render(<StructurePage />);
    
    // Click plus button to open modal
    const addButton = screen.getByTestId('add-thought-button-introduction');
    fireEvent.click(addButton);
    
    await waitFor(() => {
      expect(screen.getByTestId('edit-thought-modal')).toBeInTheDocument();
    });
    
    // Click save button in modal
    const saveButton = screen.getByText('Save');
    fireEvent.click(saveButton);
    
    // Modal should close after saving
    await waitFor(() => {
      expect(screen.queryByTestId('edit-thought-modal')).not.toBeInTheDocument();
    });
  });

  it('should handle closing the modal without saving', async () => {
    render(<StructurePage />);
    
    // Click plus button to open modal
    const addButton = screen.getByTestId('add-thought-button-introduction');
    fireEvent.click(addButton);
    
    await waitFor(() => {
      expect(screen.getByTestId('edit-thought-modal')).toBeInTheDocument();
    });
    
    // Click close button in modal
    const closeButton = screen.getByText('Close');
    fireEvent.click(closeButton);
    
    // Modal should close
    await waitFor(() => {
      expect(screen.queryByTestId('edit-thought-modal')).not.toBeInTheDocument();
    });
  });
});
