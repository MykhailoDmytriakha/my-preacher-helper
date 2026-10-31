import { fireEvent, render, screen } from '@testing-library/react';

import { useAnalysisRelations } from '@/components/bible/analysis/useAnalysisRelations';

import type { Geometry } from '@/components/bible/analysis/analysisGeometry';
import type { AnalysisState } from '@/utils/passageAnalysis';

/*
 * A word with several links of meaning, pressed in «Правка», shows them all in one menu; the pointer over one link's part
 * of it draws that link's line a little bolder, so the one being changed is seen (the owner, 31.10: «когда hover, то
 * линия… чуть-чуть жирнее становится, тогда ты понимаешь, какую линию будешь редактировать»). The editor's own test
 * (analysisEditorCuts) has no layout to draw lines in; here the words are given places.
 */
const STATE: AnalysisState = { cuts: [3, 6], links: {}, relations: [{ a: 1, b: 4, dir: 'fwd', color: 'amber' }, { a: 1, b: 7, dir: 'none', color: 'pink' }] };
const box = (row: number, k: number) => ({ x: 20 + k * 60, y: 10 + row * 40, w: 50, h: 24 });
const GEOMETRY: Geometry = {
  words: Object.fromEntries(Array.from({ length: 9 }, (_, w) => [String(w), box(Math.floor(w / 3), w % 3)])),
  leads: {}, mids: {}, flags: {}, width: 800, height: 140,
};

function Harness() {
  const relations = useAnalysisRelations({
    state: STATE, total: 9, geometry: GEOMETRY, at: (x, y) => ({ x, y }), bare: (word) => `w${word}`, editing: true, change: jest.fn(), say: jest.fn(),
  });
  return (
    <div>
      {relations.arrows.map((arrow) => <i key={arrow.key} data-arrow={arrow.key} data-strong={String(arrow.strong)} />)}
      <button type="button" onClick={() => relations.pressWord(1)}>press w1</button>
      {relations.menuNode}
    </div>
  );
}

const strong = () => Object.fromEntries([...document.querySelectorAll('[data-arrow]')].map((arrow) => [arrow.getAttribute('data-arrow'), arrow.getAttribute('data-strong')]));

it('draws bolder the line of the link whose part of the menu is pointed at, and only while it is', () => {
  render(<Harness />);
  fireEvent.click(screen.getByRole('button', { name: 'press w1' }));
  // Both links of the word lit while their menu is open, neither bolder.
  expect(strong()).toEqual({ '1-4': 'false', '1-7': 'false' });
  const second = document.querySelector<HTMLElement>('[data-relation-item="1-7"]')!;
  fireEvent.mouseEnter(second);
  expect(strong()).toEqual({ '1-4': 'false', '1-7': 'true' });
  fireEvent.mouseLeave(second);
  expect(strong()).toEqual({ '1-4': 'false', '1-7': 'false' });
  // The keyboard's focus on a control of a link does the same.
  fireEvent.focus(document.querySelector<HTMLElement>('[data-relation-item="1-4"] button')!);
  expect(strong()).toEqual({ '1-4': 'true', '1-7': 'false' });
});
