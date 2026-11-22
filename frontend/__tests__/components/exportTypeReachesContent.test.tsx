import { render } from '@testing-library/react';
import React from 'react';

import PlanPageHeader from '@/(pages)/(private)/sermons/[id]/plan/PlanPageHeader';
import SermonCard from '@/components/dashboard/SermonCard';
import { getExportContent } from '@/utils/exportContent';

import type { Sermon } from '@/models/models';

/*
 * BUG-20261122-export-txt-plan-choice-lost. The TXT window's «Thoughts / Plan» choice must reach the export wherever
 * the window shows it: the sermon card lost it (its «Plan» exported thoughts — a lone header for a sermon with none), and
 * the hand-written plan page ignored it (its «Thoughts» exported the plan).
 */
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn() }),
  usePathname: () => '/sermons/s1/plan/manual',
  useSearchParams: () => new URLSearchParams(),
}));
jest.mock('@/utils/exportContent', () => ({ getExportContent: jest.fn(() => Promise.resolve('content')) }));
type Builder = (format: 'plain' | 'markdown', options?: { includeTags?: boolean; type?: 'thoughts' | 'plan' }) => Promise<string>;
const captured: { build?: Builder } = {};
jest.mock('@/components/ExportButtons', () => ({
  __esModule: true,
  default: (props: { getExportContent: Builder }) => { captured.build = props.getExportContent; return null; },
}));
jest.mock('@components/ExportButtons', () => ({
  __esModule: true,
  default: (props: { getExportContent: Builder }) => { captured.build = props.getExportContent; return null; },
}));
jest.mock('@/components/plan/ViewPlanMenu', () => ({ __esModule: true, default: () => null }));
jest.mock('@/components/sermon/SourceNoteChips', () => ({ __esModule: true, default: () => null }));
jest.mock('@/(pages)/(private)/sermons/[id]/plan/PlanModeSwitch', () => ({ PlanModeSwitch: () => null }));
jest.mock('@/components/dashboard/QuickPlanAccessButton', () => ({ QuickPlanAccessButton: () => null }));
jest.mock('@tanstack/react-query', () => ({ useQueryClient: () => ({ invalidateQueries: jest.fn() }) }));

const sermon = { id: 's1', title: 'A sermon', verse: 'Am 3:3', date: '2026-01-01', thoughts: [] } as unknown as Sermon;

beforeEach(() => {
  jest.mocked(getExportContent).mockClear();
  captured.build = undefined;
});

it('lets the sermon card export the plan when «Plan» is chosen', async () => {
  render(<SermonCard sermon={sermon} />);
  await captured.build!('plain', { includeTags: false, type: 'plan' });
  expect(getExportContent).toHaveBeenCalledWith(sermon, undefined, expect.objectContaining({ format: 'plain', type: 'plan' }));
});

it('lets the hand-written plan page export the thoughts when «Thoughts» is chosen', async () => {
  render(
    <PlanPageHeader
      sermon={sermon}
      sermonId="s1"
      mode="note"
      combinedPlan={{ introduction: 'Plan text', main: '', conclusion: '' }}
      t={(key) => key}
      onRequestPlanOverlay={jest.fn()}
      onRequestPreachingMode={jest.fn()}
      onStartPreachingMode={jest.fn()}
    />,
  );
  await captured.build!('plain', { includeTags: true, type: 'thoughts' });
  expect(getExportContent).toHaveBeenCalledWith(sermon, undefined, expect.objectContaining({ format: 'plain', includeTags: true, type: 'thoughts' }));
});
