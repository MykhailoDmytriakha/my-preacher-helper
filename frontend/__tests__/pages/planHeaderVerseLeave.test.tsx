import { act, render, screen, waitFor, within } from '@testing-library/react';
import React from 'react';

import '@testing-library/jest-dom';
import PlanPageHeader from '@/(pages)/(private)/sermons/[id]/plan/PlanPageHeader';

import type { Sermon } from '@/models/models';

/**
 * THE PLAN'S VERSE LEAVES FOR THE BIBLE THE WAY THE SCREEN'S OTHER DOORS DO.
 *
 * The hand-written editor holds cells being typed into, and its doors out save them first and
 * stay put when the save refuses. The verse is a door out too. And the way back is this very
 * screen with its query: "?source=note" is what keeps the note editor open on return.
 */

const mockPush = jest.fn();
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
  usePathname: () => '/sermons/s1/plan/manual',
  useSearchParams: () => new URLSearchParams('source=note'),
}));
// The header's other parts have their own tests; here only the verse is read.
jest.mock('@/components/ExportButtons', () => ({ __esModule: true, default: () => null }));
jest.mock('@/components/plan/ViewPlanMenu', () => ({ __esModule: true, default: () => null }));
jest.mock('@/components/sermon/SourceNoteChips', () => ({ __esModule: true, default: () => null }));
jest.mock('@/(pages)/(private)/sermons/[id]/plan/PlanModeSwitch', () => ({ PlanModeSwitch: () => null }));

const sermon = { id: 's1', title: 'A sermon', verse: '1 Chronicles 4:9-10', date: '2026-01-01', thoughts: [] } as unknown as Sermon;

const renderHeader = (beforeSwitch?: () => Promise<boolean>) =>
  render(
    <PlanPageHeader
      sermon={sermon}
      sermonId="s1"
      mode="note"
      combinedPlan={{ introduction: '', main: '', conclusion: '' }}
      t={(key) => key}
      beforeSwitch={beforeSwitch}
      onRequestPlanOverlay={jest.fn()}
      onRequestPreachingMode={jest.fn()}
      onStartPreachingMode={jest.fn()}
    />
  );

const pressVerse = () => {
  const link = within(screen.getByTestId('plan-header-verse')).getByRole('button', { name: '1 Chronicles 4:9-10' });
  act(() => { link.click(); });
};

describe('the verse on the plan page', () => {
  beforeEach(() => mockPush.mockReset());

  it('saves the cells being edited, then opens the Bible with the way back to this very screen', async () => {
    const beforeSwitch = jest.fn().mockResolvedValue(true);
    renderHeader(beforeSwitch);
    pressVerse();
    expect(beforeSwitch).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(mockPush).toHaveBeenCalledTimes(1));
    const query = Object.fromEntries(new URL(mockPush.mock.calls[0][0], 'https://app.test').searchParams);
    expect(query).toEqual(expect.objectContaining({ book: '1-chronicles', at: '4:9', to: '10', from: '/sermons/s1/plan/manual?source=note' }));
  });

  it('stays on the plan when the save refuses: the paragraph is not left behind', async () => {
    const beforeSwitch = jest.fn().mockResolvedValue(false);
    renderHeader(beforeSwitch);
    pressVerse();
    await waitFor(() => expect(beforeSwitch).toHaveBeenCalledTimes(1));
    await act(async () => { await Promise.resolve(); });
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('stays on the plan, quietly, when the save fails outright', async () => {
    const unhandled = jest.fn();
    process.on('unhandledRejection', unhandled);
    try {
      const beforeSwitch = jest.fn().mockRejectedValue(new Error('save failed'));
      renderHeader(beforeSwitch);
      pressVerse();
      await waitFor(() => expect(beforeSwitch).toHaveBeenCalledTimes(1));
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
      expect(mockPush).not.toHaveBeenCalled();
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.off('unhandledRejection', unhandled);
    }
  });

  it('goes at once where there is nothing to save', () => {
    renderHeader();
    pressVerse();
    expect(mockPush).toHaveBeenCalledTimes(1);
  });
});
