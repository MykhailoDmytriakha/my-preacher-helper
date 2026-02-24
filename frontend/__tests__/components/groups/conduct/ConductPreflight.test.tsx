import { fireEvent, render, screen } from '@testing-library/react';

import ConductPreflight from '@/components/groups/conduct/ConductPreflight';
import { GroupBlockTemplate, GroupFlowItem } from '@/models/models';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string, opts?: { defaultValue?: string }) => opts?.defaultValue ?? key }),
}));

const mockTemplates: GroupBlockTemplate[] = [
  { id: 't1', type: 'prayer', title: 'Prayer', content: '', status: 'draft', createdAt: '', updatedAt: '' },
  { id: 't2', type: 'topic', title: 'Main Topic', content: '', status: 'filled', createdAt: '', updatedAt: '' },
];

const mockFlow: GroupFlowItem[] = [
  { id: 'f1', templateId: 't1', order: 1, durationMin: 5 },
  { id: 'f2', templateId: 't2', order: 2, durationMin: 20 },
];

describe('ConductPreflight', () => {
  const onStart = jest.fn();
  const onBack = jest.fn();

  beforeEach(() => jest.clearAllMocks());

  it('renders block titles', () => {
    render(<ConductPreflight flow={mockFlow} templates={mockTemplates} onStart={onStart} onBack={onBack} />);
    expect(screen.getByText('Prayer')).toBeInTheDocument();
    expect(screen.getByText('Main Topic')).toBeInTheDocument();
  });

  it('renders Start Meeting button', () => {
    render(<ConductPreflight flow={mockFlow} templates={mockTemplates} onStart={onStart} onBack={onBack} />);
    expect(screen.getByText(/Start Meeting/)).toBeInTheDocument();
  });

  it('calls onBack when Back button clicked', () => {
    render(<ConductPreflight flow={mockFlow} templates={mockTemplates} onStart={onStart} onBack={onBack} />);
    fireEvent.click(screen.getByText(/Back to group/));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('calls onStart with current flow and null totalMeetingMin by default', () => {
    render(<ConductPreflight flow={mockFlow} templates={mockTemplates} onStart={onStart} onBack={onBack} />);
    fireEvent.click(screen.getByText(/Start Meeting/));
    expect(onStart).toHaveBeenCalledWith(mockFlow, null);
  });

  it('calls onStart with totalMeetingMin when global time is set', () => {
    render(<ConductPreflight flow={mockFlow} templates={mockTemplates} onStart={onStart} onBack={onBack} />);
    const [totalInput] = screen.getAllByRole('spinbutton');
    fireEvent.change(totalInput, { target: { value: '50' } });
    fireEvent.click(screen.getByText(/Start Meeting/));
    expect(onStart).toHaveBeenCalledWith(expect.any(Array), 50);
  });

  it('shows blocks total duration', () => {
    render(<ConductPreflight flow={mockFlow} templates={mockTemplates} onStart={onStart} onBack={onBack} />);
    // 5 + 20 = 25 min total blocks
    expect(screen.getByText(/25/)).toBeInTheDocument();
  });

  it('updates duration and recalculates total', () => {
    render(<ConductPreflight flow={mockFlow} templates={mockTemplates} onStart={onStart} onBack={onBack} />);
    // Change first block duration from 5 to 10
    const inputs = screen.getAllByRole('spinbutton');
    // first input is totalMeetingMin, second and third are block durations
    const blockInput = inputs[1];
    fireEvent.change(blockInput, { target: { value: '10' } });
    // 10 + 20 = 30
    expect(screen.getByText(/30/)).toBeInTheDocument();
  });
});
