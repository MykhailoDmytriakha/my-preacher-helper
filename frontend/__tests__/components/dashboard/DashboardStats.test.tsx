import { render, screen } from '@testing-library/react';
import React from 'react';

import '@testing-library/jest-dom';
import DashboardStats from '@/components/dashboard/DashboardStats';
import { Sermon } from '@/models/models';

// Mock the Icons component
jest.mock('@components/Icons', () => ({
  DocumentIcon: () => <div data-testid="document-icon" />,
  PencilIcon: () => <div data-testid="pencil-icon" />,
  ChevronIcon: () => <div data-testid="chevron-icon" />,
}));

// Mock the entire i18n module
jest.mock('@locales/i18n', () => {}, { virtual: true });

// Mock the useTranslation hook
jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const translations: { [key: string]: string } = {
        'dashboard.stats.totalSermons': 'Total Sermons',
        'dashboard.stats.totalThoughts': 'Total Thoughts',
        'dashboard.stats.withOutlines': 'With Outlines',
        'dashboard.stats.latestSermon': 'Latest Sermon',
      };
      
      return translations[key] || key;
    },
  }),
}));

describe('DashboardStats Component', () => {
  // Helper function to create a date string with specific offset from today
  const dateWithOffset = (offsetDays: number) => {
    const date = new Date();
    date.setDate(date.getDate() - offsetDays);
    return date.toISOString().split('T')[0]; // YYYY-MM-DD format
  };
  
  // Define mock sermons
  const mockSermons: Sermon[] = [
    {
      id: 'sermon-1',
      title: 'Sermon With SermonOutline and Thoughts',
      verse: 'Matthew 5:1-12',
      date: dateWithOffset(5), // 5 days ago
      userId: 'user-1',
      thoughts: [
        { id: 'thought-1', text: 'Thought 1', date: '2023-01-01', tags: [] },
        { id: 'thought-2', text: 'Thought 2', date: '2023-01-02', tags: [] },
      ],
      outline: {
        introduction: [{ id: 'intro-1', text: 'Intro point 1' }],
        main: [{ id: 'main-1', text: 'Main point 1' }],
        conclusion: [{ id: 'conclusion-1', text: 'Conclusion point 1' }],
      },
    },
    {
      id: 'sermon-2',
      title: 'Sermon With Thoughts No SermonOutline',
      verse: 'John 3:16',
      date: dateWithOffset(10), // 10 days ago
      userId: 'user-1',
      thoughts: [
        { id: 'thought-3', text: 'Thought 3', date: '2023-01-03', tags: [] },
      ],
    },
    {
      id: 'sermon-3',
      title: 'Sermon With SermonOutline No Thoughts',
      verse: 'Romans 8:28',
      date: dateWithOffset(2), // 2 days ago (most recent)
      userId: 'user-1',
      thoughts: [],
      outline: {
        introduction: [{ id: 'intro-2', text: 'Intro point 2' }],
        main: [{ id: 'main-2', text: 'Main point 2' }],
        conclusion: [{ id: 'conclusion-2', text: 'Conclusion point 2' }],
      },
    },
    {
      id: 'sermon-4',
      title: 'Simple Sermon',
      verse: 'Psalms 23',
      date: dateWithOffset(15), // 15 days ago
      userId: 'user-1',
      thoughts: [],
    },
  ];
  
  it('renders all stat cards', () => {
    render(<DashboardStats sermons={mockSermons} />);
    
    // Check all stat titles are displayed
    expect(screen.getByText('Total Sermons')).toBeInTheDocument();
    expect(screen.getByText('Total Thoughts')).toBeInTheDocument();
    expect(screen.getByText('With Outlines')).toBeInTheDocument();
    expect(screen.getByText('Latest Sermon')).toBeInTheDocument();
    
    // Check all icons are rendered
    expect(screen.getByTestId('document-icon')).toBeInTheDocument();
    expect(screen.getByTestId('pencil-icon')).toBeInTheDocument();
    expect(screen.getByTestId('chevron-icon')).toBeInTheDocument();
  });
  
  it('calculates total sermons correctly', () => {
    render(<DashboardStats sermons={mockSermons} />);
    
    // Check total sermons is 4
    expect(screen.getByText('4')).toBeInTheDocument();
  });
  
  it('calculates total thoughts correctly', () => {
    render(<DashboardStats sermons={mockSermons} />);
    
    // Total thoughts across all sermons is 3
    // Need to find the specific instance since multiple numbers are displayed
    const totalThoughtsCard = screen.getByText('Total Thoughts').closest('div')?.parentElement;
    const totalThoughtsValue = totalThoughtsCard?.querySelector('p.text-xl, p.text-2xl');
    expect(totalThoughtsValue).toHaveTextContent('3');
  });
  
  it('calculates sermons with outlines correctly', () => {
    render(<DashboardStats sermons={mockSermons} />);
    
    // Sermons with outlines is 2
    const withOutlinesCard = screen.getByText('With Outlines').closest('div')?.parentElement;
    const withOutlinesValue = withOutlinesCard?.querySelector('p.text-xl, p.text-2xl');
    expect(withOutlinesValue).toHaveTextContent('2');
  });
  
  it('finds the latest sermon date correctly', () => {
    render(<DashboardStats sermons={mockSermons} />);
    
    // Get today's date and format it to match how it would appear in the UI
    const latestDateRaw = dateWithOffset(2); // The most recent sermon date
    
    // Create a Date object to format it the way the component would
    const latestDate = new Date(latestDateRaw);
    const formatter = new Intl.DateTimeFormat(undefined, { 
      year: 'numeric', 
      month: 'short', 
      day: 'numeric' 
    });
    const formattedDate = formatter.format(latestDate);
    
    // Find the formatted date in the component
    expect(screen.getByText(formattedDate)).toBeInTheDocument();
  });
  
  it('handles empty sermons array gracefully', () => {
    render(<DashboardStats sermons={[]} />);
    
    // All stats should be zero - use getAllByText instead of getByText since there are multiple '0's
    const zeroValues = screen.getAllByText('0');
    expect(zeroValues.length).toBe(3); // We expect three zeros: sermons, thoughts, and outlines
    
    // Total thoughts
    const totalThoughtsCard = screen.getByText('Total Thoughts').closest('div')?.parentElement;
    const totalThoughtsValue = totalThoughtsCard?.querySelector('p.text-xl, p.text-2xl');
    expect(totalThoughtsValue).toHaveTextContent('0');
    
    // Sermons with outlines
    const withOutlinesCard = screen.getByText('With Outlines').closest('div')?.parentElement;
    const withOutlinesValue = withOutlinesCard?.querySelector('p.text-xl, p.text-2xl');
    expect(withOutlinesValue).toHaveTextContent('0');
    
    // Latest sermon date should show placeholder
    expect(screen.getByText('--')).toBeInTheDocument();
  });
}); 