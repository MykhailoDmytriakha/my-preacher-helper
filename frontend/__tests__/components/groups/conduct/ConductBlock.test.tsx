import { fireEvent, render, screen } from '@testing-library/react';

import ConductBlock from '@/components/groups/conduct/ConductBlock';
import { GroupBlockTemplate, GroupFlowItem } from '@/models/models';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string, opts?: { defaultValue?: string }) => opts?.defaultValue ?? key }),
}));

// Mock useConductTimer so tests don't need real timers
const mockTimerReturn = {
  elapsed: 30,
  timeLeft: null as number | null,
  isOvertime: false,
  isWarning: false,
};

jest.mock('@/hooks/useConductTimer', () => ({
  useConductTimer: jest.fn(() => mockTimerReturn),
  formatTime: (s: number) => {
    const abs = Math.abs(s);
    const m = Math.floor(abs / 60).toString().padStart(2, '0');
    const sec = (abs % 60).toString().padStart(2, '0');
    return s < 0 ? `-${m}:${sec}` : `${m}:${sec}`;
  },
}));

const mockTemplate: GroupBlockTemplate = {
  id: 't1', type: 'topic', title: 'Main Topic',
  content: 'Block content here', status: 'filled', createdAt: '', updatedAt: '',
};

const mockFlowItem: GroupFlowItem = {
  id: 'f1', templateId: 't1', order: 1, durationMin: null,
  instanceNotes: 'Leader notes here',
};

const defaultProps = {
  flowItem: mockFlowItem,
  template: mockTemplate,
  index: 0,
  total: 3,
  isPaused: false,
  onPause: jest.fn(),
  onResume: jest.fn(),
  globalTimeLeft: null,
  globalIsOvertime: false,
  initialElapsed: 0,
  onTimeRecorded: jest.fn(),
  onPrev: jest.fn(),
  onNext: jest.fn(),
  onPeek: jest.fn(),
  onCompleteAll: jest.fn(),
};

describe('ConductBlock', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Reset mock return value to default after tests that override it
    const { useConductTimer } = require('@/hooks/useConductTimer');
    (useConductTimer as jest.Mock).mockImplementation(() => mockTimerReturn);
  });

  describe('the meeting screen reads like the council\'s', () => {
    it('hands the block content to the Markdown renderer, not to a plain text node', () => {
      // The content is written in the rich Markdown editor; shown raw, ** and ## reached the screen.
      // How it then renders is proven against the real react-markdown in ConductBlock.rendered.test.tsx.
      const template = { ...mockTemplate, content: '**Pray** together' };
      render(<ConductBlock {...defaultProps} template={template} />);

      expect(screen.getByTestId('markdown')).toHaveTextContent('**Pray** together');
    });

    it('offers the same text size button as the notes and the council', () => {
      render(<ConductBlock {...defaultProps} />);
      expect(screen.getByRole('button', { name: 'textScale.open' })).toBeInTheDocument();
    });

    it('scales the block body as one container and leaves the controls alone', () => {
      const { container } = render(<ConductBlock {...defaultProps} template={{ ...mockTemplate, questions: ['Why?'] }} />);
      const scaled = [...container.querySelectorAll('.meeting-scaled')];
      const inScaled = (text: string) => scaled.some((node) => node.contains(screen.getByText(text)));

      expect(inScaled('Main Topic')).toBe(true);
      expect(inScaled('Block content here')).toBe(true);
      expect(inScaled('Why?')).toBe(true);
      expect(inScaled('1 / 3')).toBe(false);
      expect(inScaled('00:30')).toBe(false);
    });

    it('keeps the leader\'s notes as typed, line breaks included, at the chosen size', () => {
      const flowItem = { ...mockFlowItem, instanceNotes: 'Line one\nLine two' };
      render(<ConductBlock {...defaultProps} flowItem={flowItem} />);
      fireEvent.click(screen.getByText('Notes'));

      const notes = screen.getByText((_, node) => node?.tagName === 'P' && node.textContent === 'Line one\nLine two');
      expect(notes).toHaveClass('whitespace-pre-wrap');
      expect(notes.closest('.meeting-scaled')).not.toBeNull();
    });
  });

  it('renders block title', () => {
    render(<ConductBlock {...defaultProps} />);
    expect(screen.getByText('Main Topic')).toBeInTheDocument();
  });

  it('renders block content', () => {
    render(<ConductBlock {...defaultProps} />);
    expect(screen.getByText('Block content here')).toBeInTheDocument();
  });

  it('shows progress counter', () => {
    render(<ConductBlock {...defaultProps} />);
    expect(screen.getByText('1 / 3')).toBeInTheDocument();
  });

  it('shows elapsed timer label when block has no duration', () => {
    render(<ConductBlock {...defaultProps} />);
    expect(screen.getByText('Elapsed')).toBeInTheDocument();
  });

  it('shows Remaining label when block has duration and time left', () => {
    const { useConductTimer } = require('@/hooks/useConductTimer');
    (useConductTimer as jest.Mock).mockReturnValue({ elapsed: 30, timeLeft: 270, isOvertime: false, isWarning: false });
    render(<ConductBlock {...defaultProps} flowItem={{ ...mockFlowItem, durationMin: 5 }} />);
    expect(screen.getByText('Remaining')).toBeInTheDocument();
  });

  it('shows Overtime label when time is negative', () => {
    const { useConductTimer } = require('@/hooks/useConductTimer');
    (useConductTimer as jest.Mock).mockReturnValue({ elapsed: 330, timeLeft: -30, isOvertime: true, isWarning: false });
    render(<ConductBlock {...defaultProps} flowItem={{ ...mockFlowItem, durationMin: 5 }} />);
    expect(screen.getByText('Overtime')).toBeInTheDocument();
  });

  it('Back button is disabled on first block (index=0)', () => {
    render(<ConductBlock {...defaultProps} index={0} />);
    const backBtn = screen.getByText(/Back/).closest('button');
    expect(backBtn).toBeDisabled();
  });

  it('Back button is enabled on non-first block', () => {
    render(<ConductBlock {...defaultProps} index={1} />);
    const backBtn = screen.getByText(/Back/).closest('button');
    expect(backBtn).toBeEnabled();
  });

  it('shows Next button on non-last block', () => {
    render(<ConductBlock {...defaultProps} index={0} total={3} />);
    expect(screen.getByText(/Next/)).toBeInTheDocument();
  });

  it('shows Overview → button on last block', () => {
    render(<ConductBlock {...defaultProps} index={2} total={3} />);
    // Two "Overview" elements: header ≡ button and the last-block Overview → button
    const overviewButtons = screen.getAllByText(/Overview/);
    expect(overviewButtons.length).toBeGreaterThanOrEqual(2);
  });

  it('calls onTimeRecorded + onNext when Next clicked', () => {
    render(<ConductBlock {...defaultProps} index={0} total={3} />);
    fireEvent.click(screen.getByText(/Next/));
    expect(defaultProps.onTimeRecorded).toHaveBeenCalledWith('f1', 30);
    expect(defaultProps.onNext).toHaveBeenCalledTimes(1);
  });

  it('calls onTimeRecorded + onCompleteAll when Overview → clicked on last block', () => {
    render(<ConductBlock {...defaultProps} index={2} total={3} />);
    // Find the "Overview →" button in the footer (not the header ≡ button)
    const buttons = screen.getAllByRole('button');
    const overviewArrowBtn = buttons.find(b => b.textContent?.includes('Overview') && b.textContent?.includes('→'));
    expect(overviewArrowBtn).toBeTruthy();
    fireEvent.click(overviewArrowBtn!);
    expect(defaultProps.onTimeRecorded).toHaveBeenCalledWith('f1', 30);
    expect(defaultProps.onCompleteAll).toHaveBeenCalledTimes(1);
  });

  it('calls onTimeRecorded + onPeek when ≡ Overview button clicked', () => {
    render(<ConductBlock {...defaultProps} index={0} total={3} />);
    // Header Overview button (no arrow, has the bars icon)
    const buttons = screen.getAllByRole('button');
    const peekBtn = buttons.find(b => b.textContent?.trim().startsWith('Overview') && !b.textContent?.includes('→'));
    expect(peekBtn).toBeTruthy();
    fireEvent.click(peekBtn!);
    expect(defaultProps.onTimeRecorded).toHaveBeenCalledWith('f1', 30);
    expect(defaultProps.onPeek).toHaveBeenCalledTimes(1);
  });

  it('shows Pause button when not paused', () => {
    render(<ConductBlock {...defaultProps} isPaused={false} />);
    expect(screen.getByText('Pause')).toBeInTheDocument();
  });

  it('shows Resume button when paused', () => {
    render(<ConductBlock {...defaultProps} isPaused={true} />);
    expect(screen.getByText('Resume')).toBeInTheDocument();
  });

  it('calls onPause when Pause clicked', () => {
    render(<ConductBlock {...defaultProps} isPaused={false} />);
    fireEvent.click(screen.getByText('Pause'));
    expect(defaultProps.onPause).toHaveBeenCalledTimes(1);
  });

  it('shows global timer when globalTimeLeft is provided', () => {
    render(<ConductBlock {...defaultProps} globalTimeLeft={300} globalIsOvertime={false} />);
    expect(screen.getByText(/⏱/)).toBeInTheDocument();
  });

  it('does not show global timer when globalTimeLeft is null', () => {
    render(<ConductBlock {...defaultProps} globalTimeLeft={null} />);
    expect(screen.queryByText(/⏱/)).not.toBeInTheDocument();
  });

  it('shows notes accordion toggle when instanceNotes present', () => {
    render(<ConductBlock {...defaultProps} />);
    expect(screen.getByText('Notes')).toBeInTheDocument();
  });

  it('does not show notes toggle when instanceNotes empty', () => {
    render(<ConductBlock {...defaultProps} flowItem={{ ...mockFlowItem, instanceNotes: undefined }} />);
    expect(screen.queryByText('Notes')).not.toBeInTheDocument();
  });
});
