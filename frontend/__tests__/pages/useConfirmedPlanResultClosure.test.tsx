import { act, renderHook, waitFor } from '@testing-library/react';

import { useConfirmedPlanResultClosure } from '@/(pages)/(private)/sermons/[id]/plan/useConfirmedPlanResultClosure';

it('keeps the offer open until every accepted word reaches the confirmed document', async () => {
  const close = jest.fn().mockResolvedValue(undefined);
  localStorage.clear();
  const opening = { first: 'Original', second: 'Original' };
  const result = { first: 'Accepted first', second: 'Accepted second' };
  const view = renderHook(({ confirmed }) => useConfirmedPlanResultClosure('owner', 'sermon', 'note', confirmed, close),
    { initialProps: { confirmed: opening } });

  act(() => { view.result.current('plan-operation', result); });
  expect(close).not.toHaveBeenCalled();

  view.rerender({ confirmed: { ...opening, first: result.first } });
  expect(close).not.toHaveBeenCalled();

  view.rerender({ confirmed: result });
  await waitFor(() => expect(close).toHaveBeenCalledWith('plan-operation'));

  view.rerender({ confirmed: { ...result } });
  expect(close).toHaveBeenCalledTimes(1);
});

it('restarts a pending confirmation on reopening and keeps it inside its original account', async () => {
  localStorage.clear();
  const close = jest.fn().mockResolvedValue(undefined);
  const final = { point: 'Confirmed words' };
  const open = (ownerId: string, confirmed: Record<string, string>) =>
    renderHook(() => useConfirmedPlanResultClosure(ownerId, 'sermon', 'thoughts', confirmed, close));
  const old = open('first-user', { point: 'Still the original' });
  act(() => { old.result.current('persists-on-navigation', final); });
  old.unmount();
  const otherAccount = open('second-user', final);
  expect(close).not.toHaveBeenCalled();
  otherAccount.unmount();
  const reopened = open('first-user', final);
  await waitFor(() => expect(close).toHaveBeenCalledWith('persists-on-navigation'));
  reopened.unmount();
  const after = open('first-user', final);
  expect(close).toHaveBeenCalledTimes(1);
  after.unmount();
});
