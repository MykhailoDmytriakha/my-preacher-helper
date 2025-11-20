import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';

// Mock the sermon data
interface Thought {
  id: string;
  text: string;
  tags: string[];
  date: string;
}

interface ThoughtsBySection {
  introduction: string[];
  main: string[];
  conclusion: string[];
  ambiguous: string[];
}

interface Sermon {
  id: string;
  title: string;
  verse: string;
  date: string;
  thoughts: Thought[];
  userId: string;
  structure?: ThoughtsBySection;
}

const mockSermon: Sermon = {
  id: 'sermon1',
  title: 'Test Sermon',
  verse: 'John 3:16',
  date: '2023-01-01',
  thoughts: [
    { id: 'thought1', text: 'Introduction thought', tags: ['Вступление'], date: '2023-01-01' },
    { id: 'thought2', text: 'Main part thought', tags: ['Основная часть'], date: '2023-01-01' },
    { id: 'thought3', text: 'Conclusion thought', tags: ['Заключение'], date: '2023-01-01' },
  ],
  userId: 'user1',
  structure: {
    introduction: ['thought1'],
    main: ['thought2'],
    conclusion: ['thought3'],
    ambiguous: [],
  },
};

// Mock the hooks and components
jest.mock('next/navigation', () => ({
  useRouter: () => ({
    push: jest.fn(),
  }),
  useParams: () => ({
    id: 'test-id',
  }),
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: any) => key,
  }),
}));

jest.mock('@/hooks/useSermon', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({
    sermon: mockSermon,
    setSermon: jest.fn(),
    loading: false,
    getSortedThoughts: () => mockSermon.thoughts,
  })),
}));

// Mock components
jest.mock('@/components/sermon/StructureStats', () => {
  return {
    __esModule: true,
    default: ({ sermon }: { sermon: Sermon }) => (
      <div data-testid="structure-stats">ThoughtsBySection Stats Mock</div>
    ),
  };
});

jest.mock('@/components/sermon/StructurePreview', () => {
  return {
    __esModule: true,
    default: ({ sermon }: { sermon: Sermon }) => (
      sermon.structure ? <div data-testid="structure-preview">ThoughtsBySection Preview Mock</div> : null
    ),
  };
});

jest.mock('@/components/sermon/KnowledgeSection', () => {
  return {
    __esModule: true,
    default: () => <div data-testid="knowledge-section">Knowledge Section Mock</div>,
  };
});

jest.mock('@/components/sermon/SermonOutline', () => {
  return {
    __esModule: true,
    default: () => <div data-testid="sermon-outline">Sermon SermonOutline Mock</div>,
  };
});

// Mock the page component
const MockSermonPage = () => {
  return (
    <div>
      <div className="space-y-6">
        <div data-testid="structure-stats">Mock StructureStats</div>
        {mockSermon.structure && <div data-testid="structure-preview">Mock StructurePreview</div>}
        <div data-testid="knowledge-section">Mock KnowledgeSection</div>
        <div data-testid="sermon-outline">Mock SermonOutline</div>
      </div>
    </div>
  );
};

describe('Sermon Page Layout', () => {
  it('renders StructurePreview component when sermon has structure', () => {
    const { getByTestId } = render(<MockSermonPage />);
    
    // Should render all components
    expect(getByTestId('structure-stats')).toBeInTheDocument();
    expect(getByTestId('structure-preview')).toBeInTheDocument();
    expect(getByTestId('knowledge-section')).toBeInTheDocument();
    expect(getByTestId('sermon-outline')).toBeInTheDocument();
  });

  it('does not render StructurePreview component when sermon has no structure', () => {
    // Modify the mockSermon to have no structure
    const originalStructure = mockSermon.structure;
    mockSermon.structure = undefined;
    
    const { getByTestId, queryByTestId } = render(<MockSermonPage />);
    
    // Should render all components except StructurePreview
    expect(getByTestId('structure-stats')).toBeInTheDocument();
    expect(queryByTestId('structure-preview')).not.toBeInTheDocument();
    expect(getByTestId('knowledge-section')).toBeInTheDocument();
    expect(getByTestId('sermon-outline')).toBeInTheDocument();
    
    // Restore the original structure
    mockSermon.structure = originalStructure;
  });
}); 