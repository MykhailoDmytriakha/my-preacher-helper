import { fireEvent, render, screen } from '@testing-library/react';

import { CouncilOutcomePanel } from '@/components/council/CouncilOutcomePanel';
import { newTopic } from '@/utils/council';

describe('Council decision draft ownership', () => {
  it('hands each edit to the document before blur or screen cleanup', () => {
    const onWrite = jest.fn();
    const { unmount } = render(<CouncilOutcomePanel topic={newTopic('Section')} onWrite={onWrite} />);
    const field = screen.getByTestId('council-decision');
    fireEvent.change(field, { target: { value: 'Decision in progress' } });
    expect(onWrite).toHaveBeenLastCalledWith({ decision: 'Decision in progress' });
    onWrite.mockClear();
    unmount();
    expect(onWrite).not.toHaveBeenCalled();
  });

  it('displays an accepted remote decision without creating a write on unmount', () => {
    const onWrite = jest.fn();
    const topic = { ...newTopic('Section'), decision: 'A' };
    const { rerender, unmount } = render(<CouncilOutcomePanel topic={topic} onWrite={onWrite} />);
    fireEvent.focus(screen.getByTestId('council-decision'));
    rerender(<CouncilOutcomePanel topic={{ ...topic, decision: 'B from another device' }} onWrite={onWrite} />);
    expect(screen.getByTestId('council-decision')).toHaveValue('B from another device');
    unmount();
    expect(onWrite).not.toHaveBeenCalled();
  });
});
