import { render, screen, within } from '@testing-library/react';

import { GroupReadOnlyContent } from '@/components/groups/GroupReadOnlyContent';
import { SermonReadOnlyContent } from '@/components/sermon/SermonReadOnlyContent';

import type { Group, Sermon } from '@/models/models';

jest.mock('@/components/MarkdownDisplay', () => ({ __esModule: true, default: ({ content }: { content: string }) => <div>{content}</div> }));

it('retains legacy and current plan sections while offering no mutation controls', () => {
  const sermon = { id: 's', title: 'Prepared sermon', verse: 'Romans 1', thoughts: [],
    outline: { introduction: [{ id: 'intro', text: 'Opening' }], main: [], conclusion: [] },
    planText: { intro: 'Saved opening text' },
    plan: { main: { outline: 'Legacy main content' }, conclusion: { outline: 'Closing content' } },
  } as unknown as Sermon;
  render(<SermonReadOnlyContent sermon={sermon} />);
  expect(screen.getByText(/Saved opening text/)).toHaveTextContent('Legacy main content');
  expect(screen.getByText(/Closing content/)).toBeInTheDocument();
  // DeviceStorageNotice says why, once for the whole app; the copy does not repeat it.
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
  expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  expect(screen.queryByRole('button')).not.toBeInTheDocument();
});

it('retains outline reminder notes and all thought text without editing or dragging', () => {
  const sermon = { id: 's', title: 'Prepared sermon', thoughts: [{ id: 't', text: 'Thought text' }],
    outline: { introduction: [{ id: 'p', text: 'Opening', note: 'Reminder note' }], main: [], conclusion: [] },
  } as unknown as Sermon;
  render(<SermonReadOnlyContent sermon={sermon} structure />);
  expect(screen.getByText('Opening')).toBeInTheDocument();
  expect(screen.getByText('Thought text')).toBeInTheDocument();
  expect(screen.getByText('Reminder note')).toBeInTheDocument();
  expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /delete|add|edit/i })).not.toBeInTheDocument();
});

it('shows the group as its page does — blocks in order with every detail, and the way into the meeting', () => {
  const group = { id: 'g', title: 'Prepared meeting', description: 'Meeting description',
    templates: [{ id: 't', title: 'Original title', content: 'Prepared content', summary: 'Summary', questions: ['Why?'], scriptureRefs: ['John 1'] },
      { id: 'unused', title: 'Additional notes', content: 'Unplaced content' }],
    flow: [{ id: 'f', templateId: 't', order: 0, durationMin: 10, instanceTitle: 'Actual title', instanceNotes: 'Personal reminder' },
      { id: 'orphan', templateId: 'gone', order: 1, durationMin: 5, instanceTitle: 'Step without its template', instanceNotes: 'Orphan reminder' }],
    meetingDates: [{ id: 'date', date: '2026-10-01', location: 'Church', audience: 'Everyone', notes: 'Meeting notes' }],
  } as unknown as Group;
  render(<GroupReadOnlyContent group={group} />);
  for (const text of ['Actual title', 'Prepared content', 'Summary', 'Why?', 'John 1', 'Personal reminder', 'Unplaced content', 'Church', 'Everyone', 'Meeting notes', 'Step without its template', 'Orphan reminder']) {
    expect(screen.getByText(text)).toBeInTheDocument();
  }
  // The meeting's blocks are a numbered list, as on the page, not headings running down a document.
  const [meetingBlocks] = screen.getAllByRole('list');
  expect(within(meetingBlocks).getAllByRole('listitem')[0]).toHaveTextContent('Actual title');
  // Reading is enough to lead the meeting: the conduct screen runs on the same copy.
  expect(screen.getByRole('link', { name: /conduct.startButton|Start Meeting/ })).toHaveAttribute('href', '/groups/g/conduct');
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
  expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  expect(screen.queryByRole('button')).not.toBeInTheDocument();
});
