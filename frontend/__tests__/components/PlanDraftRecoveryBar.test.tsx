import { render, screen } from '@testing-library/react';

import { PlanDraftRecoveryBar, recoveredCells } from '@/(pages)/(private)/sermons/[id]/plan/PlanDraftRecoveryBar';

import type { Sermon } from '@/models/models';

jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

const sermon = {
  id: 's1', userId: 'u1', title: 'T', verse: '', date: '2026-09-28', thoughts: [],
  outline: {
    introduction: [],
    main: [{ id: 'p1', text: 'Grace', subPoints: [{ id: 'sp1', text: 'Given freely', position: 1 }] }],
    conclusion: [],
  },
  planText: { p1: 'Newer text written on the phone', sp1: 'Same everywhere' },
} as unknown as Sermon;

describe('offering back text a previous session left', () => {
  it('names each card and shows what would come back beside what the server holds now', () => {
    const cells = recoveredCells({ p1: 'Yesterday on the laptop', sp1: 'Same everywhere' }, sermon);
    expect(cells.map(cell => cell.name)).toEqual(['1 · Grace', '1.1 · Given freely']);
    render(<PlanDraftRecoveryBar cells={cells} onRestore={jest.fn()} onDiscard={jest.fn()} />);
    expect(screen.getByText('1 · Grace')).toBeInTheDocument();
    expect(screen.getByText('Yesterday on the laptop')).toBeInTheDocument();
    expect(screen.getByText('Newer text written on the phone')).toBeInTheDocument();
    expect(screen.getByText('plan.draftRecoverySameOnServer')).toBeInTheDocument();
  });

  it('reads what the server holds in the old storage shape too', () => {
    const older = { ...sermon, planText: undefined, plan: { introduction: { outline: '', outlinePoints: {} }, main: { outline: '', outlinePoints: { p1: 'Stored the old way' } }, conclusion: { outline: '', outlinePoints: {} } } } as unknown as Sermon;
    const [cell] = recoveredCells({ p1: 'From the draft' }, older);
    expect(cell.current).toBe('Stored the old way');
  });
});
