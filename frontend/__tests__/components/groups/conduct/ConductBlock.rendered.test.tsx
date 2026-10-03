// Runs against the REAL react-markdown, not the global stub in jest.setup.js — the point is to see
// headings, bold and lists come out as elements on the group's meeting screen
// (see app/components/ui/__tests__/FoldableMarkdown.rendered.test.tsx for why unmock works here).
jest.unmock('react-markdown');
jest.unmock('remark-gfm');
jest.unmock('rehype-raw');
jest.unmock('rehype-sanitize');

import { render, screen } from '@testing-library/react';

import ConductBlock from '@/components/groups/conduct/ConductBlock';

import type { GroupBlockTemplate, GroupFlowItem } from '@/models/models';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string, opts?: { defaultValue?: string }) => opts?.defaultValue ?? key }),
}));

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
