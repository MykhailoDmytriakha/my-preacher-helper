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

// The verse window's text: read once, never resolved here — what is asserted is that the window opens over the block.
jest.mock('@/utils/bibleText', () => ({ ...jest.requireActual('@/utils/bibleText'), fetchBookText: jest.fn(() => new Promise(() => undefined)) }));

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

    it('wraps a title, a note or a question that has no spaces inside the block, not past its edge', () => {
      // A pasted link is one word wider than the screen: unbroken it scrolled sideways in the notes
      // and ran past the block in the questions. jsdom lays nothing out, so the rule is the seam.
      const word = `https://example.com/${'x'.repeat(200)}`;
      render(<ConductBlock {...defaultProps} flowItem={{ ...mockFlowItem, instanceNotes: word, instanceTitle: `T${word}` }} template={{ ...mockTemplate, questions: [word] }} />);
      fireEvent.click(screen.getByText('Notes'));

      expect(screen.getByRole('heading', { name: `T${word}` })).toHaveClass('break-words');
      const [question, notes] = screen.getAllByText(word);
      expect(question.tagName).toBe('SPAN');
      expect(question).toHaveClass('min-w-0', 'break-words');
      expect(notes.tagName).toBe('P');
      expect(notes).toHaveClass('break-words');
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

  // 2.5.6: a reference of the block opens its text over the meeting; the block and its timer stay where they are.
  it('opens a reference of the block over the meeting and closes it back to the same block', () => {
    render(<ConductBlock {...defaultProps} template={{ ...mockTemplate, scriptureRefs: ['Рим 8:28', 'see the handout'] }} />);
    fireEvent.click(screen.getByRole('button', { name: 'Рим 8:28' }));
    expect(screen.getByRole('dialog', { name: 'Рим 8:28' })).toBeInTheDocument();
    expect(screen.getByText('Main Topic')).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('button', { name: 'bible.sheet.close' })[0]);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(defaultProps.onNext).not.toHaveBeenCalled();
  });

  // A leader writes the passages into the block's text: the block editor has no list of them.
  // The block's Markdown is checked against the real renderer (ConductBlock.rendered.test.tsx);
  // here the plain text around it: the title, a question, the leader's notes.
  it('makes the references in the title, questions and notes links in place that open over the meeting', () => {
    const template = { ...mockTemplate, title: 'Чтение: Рим 13', questions: ['Как жить по Еф 4:1?', 'Даниил 3 года молился — почему?'] };
    render(<ConductBlock {...defaultProps} template={template} flowItem={{ ...mockFlowItem, instanceNotes: 'Дома: Пс 22.' }} />);
    expect(screen.getByRole('button', { name: 'Рим 13' }).closest('h1')).toHaveTextContent('Чтение: Рим 13');
    const ephesians = screen.getByRole('button', { name: 'Еф 4:1' });
    expect(ephesians.closest('li')).toHaveTextContent('Как жить по Еф 4:1?');
    expect(ephesians).toHaveClass('underline');
    expect(screen.queryByRole('button', { name: /Даниил/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('Notes'));
    expect(screen.getByRole('button', { name: 'Пс 22' })).toBeInTheDocument();
    fireEvent.click(ephesians);
    expect(screen.getByRole('dialog', { name: 'Еф 4:1' })).toBeInTheDocument();
  });

  it('keeps a label the app cannot read as a reference, or that names no place, as a plain label', () => {
    render(<ConductBlock {...defaultProps} template={{ ...mockTemplate, scriptureRefs: ['see the handout', 'Рим 25'] }} />);
    expect(screen.getByText('see the handout')).toBeInTheDocument();
    expect(screen.getByText('Рим 25')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'see the handout' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Рим 25' })).not.toBeInTheDocument();
  });
});
