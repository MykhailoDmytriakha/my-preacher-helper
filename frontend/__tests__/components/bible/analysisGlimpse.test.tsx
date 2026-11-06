import { render, screen } from '@testing-library/react';

import { AnalysisGlimpse } from '@/components/bible/analysis/AnalysisOutline';

/*
 * A folded analysis card in Studies shows the opening of the analysis, never more than its few first lines: a part is a
 * line of the structure, but on a phone one long part wraps into many (Codex, 04.11: an analysis of one to three long parts
 * was drawn whole on a folded card). The height is bounded always; the fade comes where the words go on past it.
 */
const FADE = '[mask-image:linear-gradient(to_bottom,black_55%,transparent)]';
const sizes = { scrollHeight: 0, clientHeight: 0 };

beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'scrollHeight', { configurable: true, get: () => sizes.scrollHeight });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => sizes.clientHeight });
});
afterAll(() => {
  delete (HTMLElement.prototype as { scrollHeight?: number }).scrollHeight;
  delete (HTMLElement.prototype as { clientHeight?: number }).clientHeight;
});

describe('the folded analysis card — its opening lines', () => {
  it('bounds a short analysis of long parts and fades it where its words go on past the bound', () => {
    sizes.scrollHeight = 240;
    sizes.clientHeight = 76;
    render(<AnalysisGlimpse text={'- Благословен Бог и Отец Господа нашего Иисуса Христа, благословивший нас во Христе всяким духовным благословением в небесах\n  - так как Он избрал нас в Нём прежде создания мира'} />);
    const glimpse = screen.getByTestId('analysis-glimpse');
    expect(glimpse).toHaveClass('max-h-[4.75rem]', 'overflow-hidden', FADE);
  });

  it('shows a short one whole, with no fade over its last line', () => {
    sizes.scrollHeight = 40;
    sizes.clientHeight = 40;
    render(<AnalysisGlimpse text={'- Благословен Бог\n  - избрал нас'} />);
    expect(screen.getByTestId('analysis-glimpse')).not.toHaveClass(FADE);
  });
});
