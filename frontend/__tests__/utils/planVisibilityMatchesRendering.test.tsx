import { cleanup, render, screen } from '@testing-library/react';
import React from 'react';

import '@testing-library/jest-dom';
import { QuickPlanAccessButton } from '@/components/dashboard/QuickPlanAccessButton';
import { renderPlanExport } from '@/utils/exportContentRenderer';
import { hasWrittenPlan, renderPlanFromSermon, writtenSections } from '@/utils/planText';
import { getSermonAccessType, getSermonPlanData, isSermonReadyForPreaching } from '@/utils/sermonPlanAccess';

import type { Sermon } from '@/models/models';

/**
 * "IS THERE A PLAN" IS ANSWERED BY WHAT THE PLAN SHOWS.
 *
 * An old sermon's whole-section string stops counting once the section is rewritten in cells,
 * even emptied — the assembled plan suppresses it. The predicates behind "Preach", the plan route
 * and exports used to count it anyway after their stored-copy rule was unified (Codex, round 5 of
 * BUG-20261002-sermon-read-only-copy-bare-page): a cleared plan stayed "ready" and exported headings.
 */
jest.mock('next/navigation', () => ({ useRouter: () => ({ push: jest.fn() }) }));
afterEach(cleanup);

const t = ((key: string) => key) as unknown as React.ComponentProps<typeof QuickPlanAccessButton>['t'];
const outline = { introduction: [{ id: 'p1', text: 'Opening' }], main: [{ id: 'p2', text: 'Body' }], conclusion: [{ id: 'p3', text: 'Closing' }] };
const clearedMainAndConclusion = {
  id: 's1', userId: 'u1', title: 'Sermon', verse: 'Verse', date: '2026-01-01', thoughts: [], outline,
  plan: { introduction: { outline: 'Old introduction' }, main: { outline: 'Cleared main' }, conclusion: { outline: 'Cleared conclusion' } },
  draft: { introduction: { outline: '' }, main: { outline: '' }, conclusion: { outline: '' } },
  planText: { p1: 'Current introduction', p2: '', p3: '' },
} as unknown as Sermon;
const allCleared = {
  ...clearedMainAndConclusion,
  plan: { introduction: { outline: '' }, main: { outline: '' }, conclusion: { outline: '' } },
  draft: { introduction: { outline: 'Cleared introduction' }, main: { outline: '' }, conclusion: { outline: '' } },
  planText: { p1: '', p2: '', p3: '' },
} as unknown as Sermon;

it('counts only the sections the plan shows', () => {
  expect(renderPlanFromSermon(clearedMainAndConclusion)).toEqual({ introduction: '## Opening\n\nCurrent introduction', main: '## Body', conclusion: '## Closing' });
  expect(writtenSections(clearedMainAndConclusion)).toEqual({ introduction: true, main: false, conclusion: false });
  expect(isSermonReadyForPreaching(clearedMainAndConclusion)).toBe(false);
});

it('takes Preach away as the last sections are cleared', () => {
  const filled = { ...clearedMainAndConclusion, planText: { p1: 'Current introduction', p2: 'Current main', p3: 'Current conclusion' } } as unknown as Sermon;
  const view = render(<QuickPlanAccessButton sermon={filled} t={t} />);
  expect(screen.getByRole('button', { name: 'plan.preachButton' })).toBeInTheDocument();
  view.rerender(<QuickPlanAccessButton sermon={clearedMainAndConclusion} t={t} />);
  expect(screen.queryByRole('button', { name: 'plan.preachButton' })).toBeNull();
});

it('offers no plan route or export when every cell was cleared over an old draft', () => {
  const labels = { sermonTitle: 'Sermon: ', scriptureText: 'Scripture: ', introduction: 'Intro', main: 'Main', conclusion: 'Conclusion' };
  expect(renderPlanFromSermon(allCleared)).toEqual({ introduction: '## Opening', main: '## Body', conclusion: '## Closing' });
  expect(hasWrittenPlan(allCleared)).toBe(false);
  expect(getSermonAccessType(allCleared)).toBe('structure');
  expect(getSermonPlanData(allCleared)).toBeUndefined();
  expect(renderPlanExport(allCleared, { format: 'markdown', includeMetadata: true, includeTags: false } as never, labels as never)).toBe('');
});
