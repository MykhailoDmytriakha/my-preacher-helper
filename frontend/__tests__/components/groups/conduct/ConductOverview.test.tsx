import { fireEvent, render, screen } from '@testing-library/react';

import ConductOverview from '@/components/groups/conduct/ConductOverview';
import { GroupBlockTemplate, GroupFlowItem } from '@/models/models';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string, opts?: { defaultValue?: string }) => opts?.defaultValue ?? key }),
}));

// Use real formatTime logic
jest.mock('@/hooks/useConductTimer', () => ({
  formatTime: (s: number) => {
    const abs = Math.abs(s);
    const m = Math.floor(abs / 60).toString().padStart(2, '0');
    const sec = (abs % 60).toString().padStart(2, '0');
    return s < 0 ? `-${m}:${sec}` : `${m}:${sec}`;
  },
}));

const mockTemplates: GroupBlockTemplate[] = [
  { id: 't1', type: 'prayer', title: 'Prayer', content: '', status: 'draft', createdAt: '', updatedAt: '' },
  { id: 't2', type: 'topic', title: 'Main Topic', content: '', status: 'filled', createdAt: '', updatedAt: '' },
  { id: 't3', type: 'questions', title: 'Q&A', content: '', status: 'draft', createdAt: '', updatedAt: '' },
];

const mockFlow: GroupFlowItem[] = [
  { id: 'f1', templateId: 't1', order: 1, durationMin: 5 },
  { id: 'f2', templateId: 't2', order: 2, durationMin: 20 },
  { id: 'f3', templateId: 't3', order: 3 },
];

describe('ConductOverview — mid-meeting peek (currentIndex = 1)', () => {
  const onSelect = jest.fn();
  const onEnd = jest.fn();

  beforeEach(() => jest.clearAllMocks());

  it('renders all block titles', () => {
    render(
      <ConductOverview flow={mockFlow} templates={mockTemplates} currentIndex={1}
        blockTimes={{ f1: 63 }} onSelect={onSelect} onEnd={onEnd} />
    );
    expect(screen.getByText('Prayer')).toBeInTheDocument();
    expect(screen.getByText('Main Topic')).toBeInTheDocument();
    expect(screen.getByText('Q&A')).toBeInTheDocument();
  });

  it('shows blue arrow (→) for current block', () => {
    render(
      <ConductOverview flow={mockFlow} templates={mockTemplates} currentIndex={1}
        blockTimes={{}} onSelect={onSelect} onEnd={onEnd} />
    );
    expect(screen.getByText('→')).toBeInTheDocument();
  });

  it('shows formatted elapsed time for visited block', () => {
    render(
      <ConductOverview flow={mockFlow} templates={mockTemplates} currentIndex={1}
        blockTimes={{ f1: 63 }} onSelect={onSelect} onEnd={onEnd} />
    );
    expect(screen.getByText('01:03')).toBeInTheDocument();
  });

  it('calls onSelect with correct index on block click', () => {
    render(
      <ConductOverview flow={mockFlow} templates={mockTemplates} currentIndex={1}
        blockTimes={{}} onSelect={onSelect} onEnd={onEnd} />
    );
    fireEvent.click(screen.getByText('Q&A'));
    expect(onSelect).toHaveBeenCalledWith(2);
  });

  it('calls onEnd when End Meeting clicked', () => {
    render(
      <ConductOverview flow={mockFlow} templates={mockTemplates} currentIndex={1}
        blockTimes={{}} onSelect={onSelect} onEnd={onEnd} />
    );
    fireEvent.click(screen.getByText('End Meeting'));
    expect(onEnd).toHaveBeenCalledTimes(1);
  });

  it('does not show "All blocks completed" banner', () => {
    render(
      <ConductOverview flow={mockFlow} templates={mockTemplates} currentIndex={1}
        blockTimes={{}} onSelect={onSelect} onEnd={onEnd} />
    );
    expect(screen.queryByText('All blocks completed')).not.toBeInTheDocument();
  });
});

describe('ConductOverview — all completed (currentIndex = flow.length)', () => {
  const onSelect = jest.fn();
  const onEnd = jest.fn();
  const blockTimes = { f1: 63, f2: 1200, f3: 180 };

  beforeEach(() => jest.clearAllMocks());

  it('shows "All blocks completed" banner', () => {
    render(
      <ConductOverview flow={mockFlow} templates={mockTemplates} currentIndex={3}
        blockTimes={blockTimes} onSelect={onSelect} onEnd={onEnd} />
    );
    expect(screen.getByText('All blocks completed')).toBeInTheDocument();
  });

  it('shows no blue arrow — all blocks have checkmarks', () => {
    render(
      <ConductOverview flow={mockFlow} templates={mockTemplates} currentIndex={3}
        blockTimes={blockTimes} onSelect={onSelect} onEnd={onEnd} />
    );
    expect(screen.queryByText('→')).not.toBeInTheDocument();
  });

  it('shows total elapsed time', () => {
    // 63 + 1200 + 180 = 1443 seconds = 24:03
    render(
      <ConductOverview flow={mockFlow} templates={mockTemplates} currentIndex={3}
        blockTimes={blockTimes} onSelect={onSelect} onEnd={onEnd} />
    );
    expect(screen.getByText('24:03')).toBeInTheDocument();
  });

  it('shows individual block elapsed times', () => {
    render(
      <ConductOverview flow={mockFlow} templates={mockTemplates} currentIndex={3}
        blockTimes={blockTimes} onSelect={onSelect} onEnd={onEnd} />
    );
    expect(screen.getByText('01:03')).toBeInTheDocument(); // f1: 63s
    expect(screen.getByText('20:00')).toBeInTheDocument(); // f2: 1200s
    expect(screen.getByText('03:00')).toBeInTheDocument(); // f3: 180s
  });
});
