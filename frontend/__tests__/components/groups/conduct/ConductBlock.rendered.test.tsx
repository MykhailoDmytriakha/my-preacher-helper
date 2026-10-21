// Runs against the REAL react-markdown, not the global stub in jest.setup.js — the point is to see
// headings, bold and lists come out as elements on the group's meeting screen
// (see app/components/ui/__tests__/FoldableMarkdown.rendered.test.tsx for why unmock works here).
jest.unmock('react-markdown');
jest.unmock('remark-gfm');
jest.unmock('rehype-raw');
jest.unmock('rehype-sanitize');

import { fireEvent, render, screen } from '@testing-library/react';

import ConductBlock from '@/components/groups/conduct/ConductBlock';

import type { GroupBlockTemplate, GroupFlowItem } from '@/models/models';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string, opts?: { defaultValue?: string }) => opts?.defaultValue ?? key }),
}));

jest.mock('@/utils/bibleText', () => ({ ...jest.requireActual('@/utils/bibleText'), fetchBookText: jest.fn(() => new Promise(() => undefined)) }));

jest.mock('@/hooks/useConductTimer', () => ({
  useConductTimer: () => ({ elapsed: 0, timeLeft: null, isOvertime: false, isWarning: false }),
  formatTime: () => '00:00',
}));

const template: GroupBlockTemplate = {
  id: 't1', type: 'topic', title: 'Main Topic', status: 'filled', createdAt: '', updatedAt: '',
  content: '## Opening\n\n**Pray** together\n\n- first\n- second',
};
const flowItem: GroupFlowItem = { id: 'f1', templateId: 't1', order: 1, durationMin: null };

it('shows the block content as formatted text: heading, bold and list', () => {
  render(
    <ConductBlock
      flowItem={flowItem} template={template} index={0} total={1} isPaused={false}
      onPause={jest.fn()} onResume={jest.fn()} globalTimeLeft={null} globalIsOvertime={false}
      initialElapsed={0} onTimeRecorded={jest.fn()} onPrev={jest.fn()} onNext={jest.fn()}
      onPeek={jest.fn()} onCompleteAll={jest.fn()}
    />
  );

  // MarkdownDisplay demotes headings ("##" becomes an h4); what matters is that it is a heading.
  expect(screen.getByRole('heading', { name: 'Opening' })).toBeInTheDocument();
  expect(screen.getByText('Pray').tagName).toBe('STRONG');
  expect(screen.getAllByRole('listitem').map((item) => item.textContent)).toEqual(['first', 'second']);
  expect(screen.queryByText(/\*\*Pray\*\*/)).not.toBeInTheDocument();
});

// A leader writes the passages into the block's text, Markdown and all: each is a link where it
// stands, drawn as the sermon's verse is, and opens over the meeting. Prose stays prose.
it('makes every reference in the block\'s Markdown a link in place that opens over the meeting', () => {
  render(
    <ConductBlock
      flowItem={flowItem}
      template={{ ...template, content: 'Прочитайте **Рим 12:1–2** и Рим 13. Даниил 3 года молился.\n\n- Бытие 13:1–12.\n\n`Рим 8:28`' }}
      index={0} total={1} isPaused={false}
      onPause={jest.fn()} onResume={jest.fn()} globalTimeLeft={null} globalIsOvertime={false}
      initialElapsed={0} onTimeRecorded={jest.fn()} onPrev={jest.fn()} onNext={jest.fn()}
      onPeek={jest.fn()} onCompleteAll={jest.fn()}
    />
  );
  const romans = screen.getByRole('button', { name: 'Рим 13' });
  expect(romans.closest('p')).toHaveTextContent('Прочитайте Рим 12:1–2 и Рим 13. Даниил 3 года молился.');
  expect(romans).toHaveClass('underline');
  // Inside bold and inside a list item too; never inside code, never a count.
  expect(screen.getByRole('button', { name: 'Рим 12:1–2' }).closest('strong')).not.toBeNull();
  expect(screen.getByRole('button', { name: 'Бытие 13:1–12' }).closest('li')).not.toBeNull();
  expect(screen.queryByRole('button', { name: 'Рим 8:28' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /Даниил/ })).not.toBeInTheDocument();
  // No chip repeats them under the text.
  expect(screen.getAllByRole('button', { name: /^(Рим|Бытие) / })).toHaveLength(3);
  fireEvent.click(romans);
  expect(screen.getByRole('dialog', { name: 'Рим 13' })).toBeInTheDocument();
});

// A block whose own words do not say the language takes the group's (Codex, 2026-10-21): a Ukrainian group's
// "1Цар 3:5" is 1 Kings, and an English reader sees which Bible it is in.
it('reads a kept reference in the group\'s language when the block\'s words do not say it, and marks it', () => {
  const kept = { ...template, title: 'Соломон', content: 'Сон', scriptureRefs: ['1Цар 3:5'] };
  const props = {
    flowItem, index: 0, total: 1, isPaused: false, onPause: jest.fn(), onResume: jest.fn(), globalTimeLeft: null, globalIsOvertime: false,
    initialElapsed: 0, onTimeRecorded: jest.fn(), onPrev: jest.fn(), onNext: jest.fn(), onPeek: jest.fn(), onCompleteAll: jest.fn(),
  };
  const { unmount } = render(<ConductBlock {...props} template={kept} groupWrittenIn="uk" />);
  expect(screen.getByText('bible.translations.ubio.short')).toBeInTheDocument();
  unmount();
  render(<ConductBlock {...props} template={kept} />);
  expect(screen.queryByText('bible.translations.ubio.short')).not.toBeInTheDocument();
});

// Codex's review, 2026-10-21: a book kept whole ("Руфь") was a dead chip; it opens at the book's start over the meeting.
it('opens a book kept whole over the meeting, and leaves a place its Bible lacks a label', () => {
  const kept = { ...template, scriptureRefs: ['Руфь', 'Рим 25'] };
  render(
    <ConductBlock
      flowItem={flowItem} template={kept} index={0} total={1} isPaused={false} onPause={jest.fn()} onResume={jest.fn()}
      globalTimeLeft={null} globalIsOvertime={false} initialElapsed={0} onTimeRecorded={jest.fn()} onPrev={jest.fn()}
      onNext={jest.fn()} onPeek={jest.fn()} onCompleteAll={jest.fn()}
    />
  );
  expect(screen.queryByRole('button', { name: 'Рим 25' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Руфь' }));
  expect(screen.getByRole('dialog', { name: 'Руфь' })).toBeInTheDocument();
});
