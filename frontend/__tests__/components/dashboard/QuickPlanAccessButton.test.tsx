import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { QuickPlanAccessButton } from '@/components/dashboard/QuickPlanAccessButton';
import { Sermon } from '@/models/models';

// Mock Next.js router
const mockPush = jest.fn();
jest.mock('next/navigation', () => ({
  useRouter: () => ({
    push: mockPush,
  }),
}));

// Mock the sermonPlanAccess utilities
jest.mock('@/utils/sermonPlanAccess', () => ({
  getSermonAccessType: jest.fn(),
  getSermonPlanAccessRoute: jest.fn(),
  isSermonReadyForPreaching: jest.fn(),
}));

// Import the mocked functions
import { getSermonAccessType, getSermonPlanAccessRoute, isSermonReadyForPreaching } from '@/utils/sermonPlanAccess';

const mockGetSermonAccessType = getSermonAccessType as jest.MockedFunction<typeof getSermonAccessType>;
const mockGetSermonPlanAccessRoute = getSermonPlanAccessRoute as jest.MockedFunction<typeof getSermonPlanAccessRoute>;
const mockIsSermonReadyForPreaching = isSermonReadyForPreaching as jest.MockedFunction<typeof isSermonReadyForPreaching>;

describe('QuickPlanAccessButton Component', () => {
  const mockT = jest.fn((key: string) => {
    const translations: { [key: string]: string } = {
      'dashboard.toPlan': 'To plan',
      'dashboard.toStructure': 'To structure',
      'dashboard.goToPlan': 'Go to plan',
      'dashboard.goToStructure': 'Go to structure',
    };
    return translations[key] || key;
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockT.mockClear();
  });

  it('renders structure button by default when sermon has no plan or structure data', () => {
    mockGetSermonAccessType.mockReturnValue('structure');
    mockGetSermonPlanAccessRoute.mockReturnValue('/structure?sermonId=sermon-1');
    mockIsSermonReadyForPreaching.mockReturnValue(false);

    const sermon: Sermon = {
      id: 'sermon-1',
      title: 'Test Sermon',
      verse: 'John 3:16',
      date: '2023-01-01',
      thoughts: [],
      userId: 'user-1',
    };

    render(<QuickPlanAccessButton sermon={sermon} t={mockT as any} />);

    const buttons = screen.getAllByRole('button');
    expect(buttons).toHaveLength(1);
    expect(buttons[0]).toHaveTextContent('To structure');
    expect(buttons[0]).toHaveClass('bg-blue-600');
  });

  it('renders plan access button when access type is plan', () => {
    mockGetSermonAccessType.mockReturnValue('plan');
    mockGetSermonPlanAccessRoute.mockReturnValue('/sermons/sermon-1/plan');
    mockIsSermonReadyForPreaching.mockReturnValue(false);

    const sermon: Sermon = {
      id: 'sermon-1',
      title: 'Test Sermon',
      verse: 'Matthew 5:1-12',
      date: '2023-01-01',
      thoughts: [{ id: 'thought-1', text: 'Test thought', outlinePointId: 'point-1', date: '2023-01-01', tags: [] }],
      plan: {
        introduction: { outline: 'Intro plan' },
        main: { outline: 'Main plan' },
        conclusion: { outline: 'Conclusion plan' },
      },
      userId: 'user-1',
    };

    render(<QuickPlanAccessButton sermon={sermon} t={mockT as any} />);

    const buttons = screen.getAllByRole('button');
    expect(buttons).toHaveLength(1);
    expect(buttons[0]).toHaveAttribute('title', 'Go to plan');
    expect(buttons[0]).toHaveTextContent('To plan');
    expect(buttons[0]).toHaveClass('bg-green-600');
    expect(buttons[0]).toHaveClass('hover:bg-green-700');
    expect(buttons[0]).toHaveClass('text-white');
  });

  it('renders structure access button when access type is structure', () => {
    mockGetSermonAccessType.mockReturnValue('structure');
    mockGetSermonPlanAccessRoute.mockReturnValue('/structure?sermonId=sermon-1');
    mockIsSermonReadyForPreaching.mockReturnValue(false);

    const sermon: Sermon = {
      id: 'sermon-1',
      title: 'Test Sermon',
      verse: 'John 3:16',
      date: '2023-01-01',
      thoughts: [{ id: 'thought-1', text: 'Test thought', date: '2023-01-01', tags: [] }],
      structure: {
        introduction: ['Intro point'],
        main: ['Main point'],
        conclusion: ['Conclusion point'],
        ambiguous: [],
      },
      userId: 'user-1',
    };

    render(<QuickPlanAccessButton sermon={sermon} t={mockT as any} />);

    const button = screen.getByRole('button');
    expect(button).toBeInTheDocument();
    expect(button).toHaveAttribute('title', 'Go to structure');
    expect(button).toHaveTextContent('To structure');
    expect(button).toHaveClass('bg-blue-600');
    expect(button).toHaveClass('hover:bg-blue-700');
    expect(button).toHaveClass('text-white');
  });

  it('applies correct styling classes', () => {
    mockGetSermonAccessType.mockReturnValue('plan');
    mockGetSermonPlanAccessRoute.mockReturnValue('/sermons/sermon-1/plan');
    mockIsSermonReadyForPreaching.mockReturnValue(false);

    const sermon: Sermon = {
      id: 'sermon-1',
      title: 'Test Sermon',
      verse: 'Luke 2:11',
      date: '2023-01-01',
      thoughts: [{ id: 'thought-1', text: 'Test thought', outlinePointId: 'point-1', date: '2023-01-01', tags: [] }],
      plan: {
        introduction: { outline: 'Intro plan' },
        main: { outline: 'Main plan' },
        conclusion: { outline: 'Conclusion plan' },
      },
      userId: 'user-1',
    };

    render(<QuickPlanAccessButton sermon={sermon} t={mockT as any} />);

    const buttons = screen.getAllByRole('button');
    expect(buttons[0]).toHaveClass('inline-flex');
    expect(buttons[0]).toHaveClass('items-center');
    expect(buttons[0]).toHaveClass('px-3');
    expect(buttons[0]).toHaveClass('py-1');
    expect(buttons[0]).toHaveClass('text-xs');
    expect(buttons[0]).toHaveClass('font-medium');
    expect(buttons[0]).toHaveClass('rounded-md');
    expect(buttons[0]).toHaveClass('transition-colors');
    expect(buttons[0]).toHaveClass('bg-green-600');
    expect(buttons[0]).toHaveClass('hover:bg-green-700');
    expect(buttons[0]).toHaveClass('text-white');
  });

  it('navigates to correct route when clicked', () => {
    mockGetSermonAccessType.mockReturnValue('plan');
    mockGetSermonPlanAccessRoute.mockReturnValue('/sermons/sermon-1/plan');
    mockIsSermonReadyForPreaching.mockReturnValue(false);

    const sermon: Sermon = {
      id: 'sermon-1',
      title: 'Test Sermon',
      verse: 'Romans 8:28',
      date: '2023-01-01',
      thoughts: [{ id: 'thought-1', text: 'Test thought', outlinePointId: 'point-1', date: '2023-01-01', tags: [] }],
      plan: {
        introduction: { outline: 'Intro plan' },
        main: { outline: 'Main plan' },
        conclusion: { outline: 'Conclusion plan' },
      },
      userId: 'user-1',
    };

    render(<QuickPlanAccessButton sermon={sermon} t={mockT as any} />);

    const button = screen.getByRole('button');
    button.click();

    expect(mockPush).toHaveBeenCalledWith('/sermons/sermon-1/plan');
  });

  it('calls getSermonAccessType with correct sermon', () => {
    mockGetSermonAccessType.mockReturnValue('structure');
    mockGetSermonPlanAccessRoute.mockReturnValue('/structure?sermonId=sermon-1');
    mockIsSermonReadyForPreaching.mockReturnValue(false);

    const sermon: Sermon = {
      id: 'sermon-1',
      title: 'Test Sermon',
      verse: 'Ephesians 2:8-9',
      date: '2023-01-01',
      thoughts: [],
      userId: 'user-1',
    };

    render(<QuickPlanAccessButton sermon={sermon} t={mockT as any} />);

    expect(mockGetSermonAccessType).toHaveBeenCalledWith(sermon);
    expect(mockGetSermonAccessType).toHaveBeenCalledTimes(1);
  });

  it('calls getSermonPlanAccessRoute with correct parameters when access type exists', () => {
    mockGetSermonAccessType.mockReturnValue('plan');
    mockGetSermonPlanAccessRoute.mockReturnValue('/sermons/sermon-1/plan');
    mockIsSermonReadyForPreaching.mockReturnValue(false);

    const sermon: Sermon = {
      id: 'sermon-1',
      title: 'Test Sermon',
      verse: 'Philippians 4:13',
      date: '2023-01-01',
      thoughts: [{ id: 'thought-1', text: 'Test thought', outlinePointId: 'point-1', date: '2023-01-01', tags: [] }],
      plan: {
        introduction: { outline: 'Intro plan' },
        main: { outline: 'Main plan' },
        conclusion: { outline: 'Conclusion plan' },
      },
      userId: 'user-1',
    };

    render(<QuickPlanAccessButton sermon={sermon} t={mockT as any} />);

    expect(mockGetSermonPlanAccessRoute).toHaveBeenCalledWith('sermon-1', sermon);
    expect(mockGetSermonPlanAccessRoute).toHaveBeenCalledTimes(1);
  });

  it('renders preach button when plan is ready for preaching', () => {
    mockGetSermonAccessType.mockReturnValue('plan');
    mockGetSermonPlanAccessRoute.mockReturnValue('/sermons/sermon-1/plan');
    mockIsSermonReadyForPreaching.mockReturnValue(true);

    const sermon: Sermon = {
      id: 'sermon-1',
      title: 'Test Sermon',
      verse: 'Matthew 28:19-20',
      date: '2023-01-01',
      thoughts: [{ id: 'thought-1', text: 'Test thought', outlinePointId: 'point-1', date: '2023-01-01', tags: [] }],
      plan: {
        introduction: { outline: 'Intro plan with content' },
        main: { outline: 'Main plan with content' },
        conclusion: { outline: 'Conclusion plan with content' },
      },
      userId: 'user-1',
    };

    render(<QuickPlanAccessButton sermon={sermon} t={mockT as any} />);

    const buttons = screen.getAllByRole('button');
    expect(buttons).toHaveLength(2);
    expect(buttons[0]).toHaveTextContent('To plan');
    expect(buttons[1]).toHaveTextContent('plan.preachButton');
    expect(buttons[1]).toHaveClass('bg-green-600');
  });

  it('does not render preach button when plan is not ready for preaching', () => {
    mockGetSermonAccessType.mockReturnValue('plan');
    mockGetSermonPlanAccessRoute.mockReturnValue('/sermons/sermon-1/plan');
    mockIsSermonReadyForPreaching.mockReturnValue(false);

    const sermon: Sermon = {
      id: 'sermon-1',
      title: 'Test Sermon',
      verse: 'John 14:6',
      date: '2023-01-01',
      thoughts: [{ id: 'thought-1', text: 'Test thought', outlinePointId: 'point-1', date: '2023-01-01', tags: [] }],
      plan: {
        introduction: { outline: '' }, // Empty content
        main: { outline: 'Main plan' },
        conclusion: { outline: 'Conclusion plan' },
      },
      userId: 'user-1',
    };

    render(<QuickPlanAccessButton sermon={sermon} t={mockT as any} />);

    const buttons = screen.getAllByRole('button');
    expect(buttons).toHaveLength(1);
    expect(buttons[0]).toHaveTextContent('To plan');
  });
});
