import { render } from '@testing-library/react';

import { BibleIcon } from '@/components/bible/BibleIcon';

/*
 * The owner, 04.11: «Берем вариант книга с крестом и лентой» (canvas row «Значок Библии», 2). One sign, one component: the
 * menu, every door to the Bible and every place that means the Bible draw it, so a new sign is one change here.
 */
describe('the Bible\'s sign', () => {
  it('is a closed book with a cross and a ribbon hanging below it — not the open book, which is a sermon\'s', () => {
    const { container } = render(<BibleIcon className="h-4 w-4" />);
    const d = container.querySelector('path')?.getAttribute('d') ?? '';
    expect(d).toContain('M12 6.75v6.75M9.75 9h4.5'); // the cross on the cover
    expect(d).toContain('M15 18v4.5l1.125-1.125L17.25 22.5V18'); // the ribbon
    expect(container.querySelector('svg')).toHaveClass('h-4', 'w-4');
    expect(container.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
  });
});
