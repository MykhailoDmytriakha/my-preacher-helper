import { render, screen } from '@testing-library/react';
import React from 'react';

import '@testing-library/jest-dom';
import { ProgressSidebar } from '@/components/plan/ProgressSidebar';
import { SERMON_SECTION_COLORS } from '@/utils/themeColors';

import type { OutlinePoint } from '@/models/models';

/**
 * The strip has one job: say how much of the plan is still empty, section by section. Its
 * caller decides what "filled" means — see the component — so what is checked here is that it
 * reports the answer it was handed, in the colour of the right section, and stays away when
 * there is nothing to report.
 */

const outline: {
  introduction: OutlinePoint[];
  main: OutlinePoint[];
  conclusion: OutlinePoint[];
} = {
  introduction: [
    { id: 'intro-1', text: 'Introduction Point 1' },
    { id: 'intro-2', text: 'Introduction Point 2' },
  ],
  main: [
    { id: 'main-1', text: 'Main Point 1' },
    { id: 'main-2', text: 'Main Point 2' },
    { id: 'main-3', text: 'Main Point 3' },
  ],
  conclusion: [{ id: 'conc-1', text: 'Conclusion Point 1' }],
};

const filledPointIds: Record<string, boolean> = {
  'intro-1': true,
  'intro-2': false,
  'main-1': true,
  'main-2': true,
  'main-3': false,
  'conc-1': true,
};

const markers = () => screen.queryAllByTestId('plan-progress-point');

describe('ProgressSidebar', () => {
  it('shows one marker per outline point', () => {
    render(<ProgressSidebar outline={outline} filledPointIds={filledPointIds} />);

    expect(markers()).toHaveLength(6);
  });

  it('keeps the points of a section together, in outline order', () => {
    render(<ProgressSidebar outline={outline} filledPointIds={filledPointIds} />);

    const groups = screen.getByTestId('plan-progress-map').children;

    expect(Array.from(groups).map((group) => group.children.length)).toEqual([2, 3, 1]);
    expect(markers()[0]).toHaveAttribute('title', expect.stringContaining('Introduction Point 1'));
  });

  it('paints a filled point in the colour of its own section', () => {
    render(<ProgressSidebar outline={outline} filledPointIds={filledPointIds} />);

    expect(screen.getByTitle(/^Introduction Point 1/)).toHaveStyle({
      backgroundColor: SERMON_SECTION_COLORS.introduction.light,
    });
    expect(screen.getByTitle(/^Main Point 1/)).toHaveStyle({
      backgroundColor: SERMON_SECTION_COLORS.mainPart.light,
    });
    expect(screen.getByTitle(/^Conclusion Point 1/)).toHaveStyle({
      backgroundColor: SERMON_SECTION_COLORS.conclusion.light,
    });
  });

  /**
   * The empty state is a THEME-AWARE CLASS, not an inline colour. It used to be resolved in
   * JavaScript by watching the root element for the `dark` class, which meant a whole observer
   * existed to pick one shade of grey.
   */
  it('leaves an empty point to the theme instead of painting it', () => {
    render(<ProgressSidebar outline={outline} filledPointIds={filledPointIds} />);

    const empty = screen.getByTitle(/^Introduction Point 2/);

    expect(empty.style.backgroundColor).toBe('');
    expect(empty).toHaveClass('bg-gray-200', 'dark:bg-gray-700');
  });

  it('says in each label whether that point is written or still empty', () => {
    render(<ProgressSidebar outline={outline} filledPointIds={filledPointIds} />);

    expect(
      screen.getByTitle('Introduction Point 1 — plan.progressMap.filled')
    ).toBeInTheDocument();
    expect(
      screen.getByTitle('Introduction Point 2 — plan.progressMap.empty')
    ).toBeInTheDocument();
  });

  it('treats a point nobody has answered for as empty', () => {
    render(<ProgressSidebar outline={outline} filledPointIds={{}} />);

    markers().forEach((marker) => {
      expect(marker.style.backgroundColor).toBe('');
    });
  });

  it('renders nothing when the plan has no points at all', () => {
    const { container } = render(
      <ProgressSidebar
        outline={{ introduction: [], main: [], conclusion: [] }}
        filledPointIds={{}}
      />
    );

    expect(container.firstChild).toBeNull();
  });

  it('sits at the left edge, clear of the page flow', () => {
    render(<ProgressSidebar outline={outline} filledPointIds={filledPointIds} />);

    expect(screen.getByTestId('plan-progress-map')).toHaveClass(
      'fixed',
      'left-4',
      'top-1/2',
      '-translate-y-1/2'
    );
  });
});
