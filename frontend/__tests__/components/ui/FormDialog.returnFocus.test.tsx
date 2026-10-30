import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useRef, useState } from 'react';

import FormDialog from '@/components/ui/FormDialog';

function FocusReturnHarness({ removeOpener }: { removeOpener: boolean }) {
  const stableTarget = useRef<HTMLButtonElement>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [openerVisible, setOpenerVisible] = useState(true);
  const open = () => {
    setDialogOpen(true);
    if (removeOpener) setOpenerVisible(false);
  };
  const close = () => setDialogOpen(false);

  return (
    <>
      <button ref={stableTarget} type="button">Continue at reader</button>
      {openerVisible ? <button type="button" onClick={open}>Open comment</button> : null}
      {dialogOpen ? (
        removeOpener ? (
          <FormDialog {...{ returnFocusTo: stableTarget }} title="Comment" onClose={close}>
            <label>Comment text<input aria-label="Comment text" /></label>
          </FormDialog>
        ) : (
          <FormDialog title="Comment" onClose={close}>
            <label>Comment text<input aria-label="Comment text" /></label>
          </FormDialog>
        )
      ) : null}
    </>
  );
}

describe('a dialog returns focus after its opener changes', () => {
  it('returns focus to the stable reader button when its temporary opener is removed', async () => {
    const user = userEvent.setup();
    render(<FocusReturnHarness removeOpener />);

    await user.click(screen.getByRole('button', { name: 'Open comment' }));
    expect(await screen.findByRole('dialog', { name: 'Comment' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Open comment' })).toBeNull();

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'Comment' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Continue at reader' })).toHaveFocus();
  });

  it('still returns focus to the opener when it remains mounted', async () => {
    const user = userEvent.setup();
    render(<FocusReturnHarness removeOpener={false} />);
    const opener = screen.getByRole('button', { name: 'Open comment' });

    await user.click(opener);
    expect(await screen.findByRole('dialog', { name: 'Comment' })).toBeInTheDocument();

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'Comment' })).toBeNull();
    expect(opener).toHaveFocus();
  });
});
