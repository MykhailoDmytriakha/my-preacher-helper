import { render, screen, within } from '@testing-library/react';

import { GroupReadOnlyContent } from '@/components/groups/GroupReadOnlyContent';

import type { Group } from '@/models/models';

jest.mock('@/components/MarkdownDisplay', () => ({ __esModule: true, default: ({ content }: { content: string }) => <div>{content}</div> }));

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
