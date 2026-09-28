import { fireEvent, render, screen } from '@testing-library/react';

import { OrphanedPlanText, orphanedCells } from '@/(pages)/(private)/sermons/[id]/plan/OrphanedPlanText';

jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock('sonner', () => ({ toast: { success: jest.fn(), error: jest.fn() } }));
const mockCopy = jest.fn();
jest.mock('@/hooks/useClipboard', () => ({ useClipboard: () => ({ copyToClipboard: mockCopy }) }));

describe('text whose card was removed elsewhere', () => {
  it('keeps only unsaved, non-empty cells whose node the outline lost', () => {
    const cells = orphanedCells(
      { gone: 'Paragraph typed here', kept: 'Still in the plan', empty: '  ', saved: 'Already saved' },
      { gone: true, kept: true, empty: true, saved: false },
      new Set(['kept'])
    );
    expect(cells).toEqual([{ id: 'gone', text: 'Paragraph typed here' }]);
  });

  it('shows the words in full with copy and let-go', () => {
    const onDiscard = jest.fn();
    render(<OrphanedPlanText cells={[{ id: 'gone', text: 'Paragraph typed here' }]} onDiscard={onDiscard} />);
    expect(screen.getByText('Paragraph typed here')).toBeInTheDocument();
    fireEvent.click(screen.getByText('plan.orphanedCopy'));
    expect(mockCopy).toHaveBeenCalledWith('Paragraph typed here');
    fireEvent.click(screen.getByText('plan.orphanedDiscard'));
    expect(onDiscard).toHaveBeenCalledWith(['gone']);
  });

  it('says nothing when no text is orphaned', () => {
    const { container } = render(<OrphanedPlanText cells={[]} onDiscard={jest.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });
});
