import { Dialog, DialogPanel, DialogTitle } from '@headlessui/react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React, { useEffect, useState } from 'react';

import ConfirmModal from '@/components/ui/ConfirmModal';
import FormDialog from '@/components/ui/FormDialog';
import { useModalLayer } from '@/hooks/useModalLayer';

jest.unmock('react-dom');
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

function Layer({ active = true, delayed = false, empty = false }: { active?: boolean; delayed?: boolean; empty?: boolean }) {
  const layer = useModalLayer({ onClose: () => undefined, active });
  const [ready, setReady] = useState(!delayed);
  useEffect(() => { setReady(true); }, []);
  return ready && active ? <div {...layer}><div role="dialog" aria-label="Picker">
    {!empty && <><button>First</button><input aria-label="Draft" /><button>Last</button></>}
  </div></div> : null;
}

function opener() {
  const button = document.createElement('button');
  button.textContent = 'Open';
  document.body.append(button);
  button.focus();
  return button;
}

afterEach(() => { document.querySelectorAll('body > button').forEach(node => node.remove()); });

it('moves focus into a form, wraps both ways, and restores its opener', async () => {
  const open = opener();
  const user = userEvent.setup();
  const { unmount } = render(<FormDialog title="Group" showCloseButton onClose={() => undefined} footer={<button>Save</button>}><input aria-label="Title" /></FormDialog>);
  const dialog = screen.getByRole('dialog');
  expect(dialog).toContainElement(document.activeElement as HTMLElement);
  screen.getByRole('button', { name: 'Save' }).focus();
  await user.tab();
  expect(screen.getByRole('button', { name: 'common.close' })).toHaveFocus();
  await user.tab({ shift: true });
  expect(screen.getByRole('button', { name: 'Save' })).toHaveFocus();
  unmount();
  expect(open).toHaveFocus();
});

it('preserves explicit autofocus on the safe cancel action and restores the real opener', () => {
  const open = opener();
  const { unmount } = render(<ConfirmModal isOpen onClose={() => undefined} onConfirm={() => undefined} title="Delete?" />);
  expect(screen.getByRole('button', { name: 'common.cancel' })).toHaveFocus();
  unmount();
  expect(open).toHaveFocus();
});

it('registers a portal panel that first renders after the component mount', async () => {
  opener();
  const user = userEvent.setup();
  render(<Layer delayed />);
  expect(screen.getByRole('button', { name: 'First' })).toHaveFocus();
  screen.getByRole('button', { name: 'Last' }).focus();
  await user.tab();
  expect(screen.getByRole('button', { name: 'First' })).toHaveFocus();
});

it('leaves inactive layers alone and handles each reopening from its current opener', () => {
  const open = opener();
  const { rerender } = render(<Layer active={false} />);
  expect(open).toHaveFocus();
  rerender(<Layer />);
  expect(screen.getByRole('button', { name: 'First' })).toHaveFocus();
  rerender(<Layer active={false} />);
  expect(open).toHaveFocus();
  const other = opener();
  rerender(<Layer />);
  rerender(<Layer active={false} />);
  expect(other).toHaveFocus();
});

it('does not reset an edited field when its layer rerenders', () => {
  opener();
  const { rerender } = render(<Layer />);
  const draft = screen.getByRole('textbox');
  draft.focus();
  fireEvent.change(draft, { target: { value: 'Keep typing' } });
  rerender(<Layer />);
  expect(draft).toHaveFocus();
  expect(draft).toHaveValue('Keep typing');
});

it('keeps Tab in an empty dialog without giving it to the background', async () => {
  opener();
  render(<Layer empty />);
  const dialog = screen.getByRole('dialog');
  expect(dialog).toHaveFocus();
  await userEvent.setup().tab();
  expect(dialog).toHaveFocus();
});

it('skips hidden, disabled, negative-tabindex and inert controls in the Tab ring', async () => {
  function HiddenControls() {
    const layer = useModalLayer({ onClose: () => undefined });
    return <div {...layer}><div role="dialog"><button>First</button><button disabled>Disabled</button><button tabIndex={-1}>Programmatic only</button><input type="hidden" /><div hidden><button>Hidden</button></div><div style={{ display: 'none' }}><button>CSS hidden</button></div><div inert><button>Inert</button></div><button>Last</button></div></div>;
  }
  render(<HiddenControls />);
  const user = userEvent.setup();
  screen.getByRole('button', { name: 'Last' }).focus();
  await user.tab();
  expect(screen.getByRole('button', { name: 'First' })).toHaveFocus();
  await user.tab({ shift: true });
  expect(screen.getByRole('button', { name: 'Last' })).toHaveFocus();
});

it('returns from the top dialog to its invoking control in the parent and protects the parent', async () => {
  const open = opener();
  function Nested() {
    const [inner, setInner] = useState(false);
    return <FormDialog title="Parent" onClose={() => undefined}><button onClick={() => setInner(true)}>Ask</button>{inner && <ConfirmModal isOpen title="Question" onClose={() => setInner(false)} onConfirm={() => undefined} />}</FormDialog>;
  }
  const user = userEvent.setup();
  const { unmount } = render(<Nested />);
  await user.click(screen.getByRole('button', { name: 'Ask' }));
  await user.tab();
  expect(screen.getByRole('dialog', { name: 'Question' })).toContainElement(document.activeElement as HTMLElement);
  await user.keyboard('{Escape}');
  expect(screen.getByRole('dialog', { name: 'Parent' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Ask' })).toHaveFocus();
  unmount();
  expect(open).toHaveFocus();
});

it('does not steal focus when a lower layer disappears under the active dialog', () => {
  const open = opener();
  const view = (lower: boolean) => <>{lower && <FormDialog title="Lower" onClose={() => undefined}>Lower</FormDialog>}<FormDialog title="Top" onClose={() => undefined}><input aria-label="Top draft" /></FormDialog></>;
  const { rerender, unmount } = render(view(true));
  const draft = screen.getByRole('textbox', { name: 'Top draft' });
  draft.focus();
  rerender(view(false));
  expect(draft).toHaveFocus();
  unmount();
  expect(open).toHaveFocus();
});

it('keeps focus ownership through StrictMode effect replay', () => {
  const open = opener();
  const { unmount } = render(<React.StrictMode><Layer /></React.StrictMode>);
  expect(screen.getByRole('button', { name: 'First' })).toHaveFocus();
  unmount();
  expect(open).toHaveFocus();
});


it('lets an editor handle its own Tab command before the dialog considers navigation', () => {
  const handled = jest.fn();
  render(<FormDialog title="Editor" onClose={() => undefined}><textarea aria-label="Text" onKeyDown={event => {
    if (event.key === 'Tab') { event.preventDefault(); handled(); }
  }} /></FormDialog>);
  const text = screen.getByRole('textbox');
  text.focus();
  fireEvent.keyDown(text, { key: 'Tab' });
  expect(handled).toHaveBeenCalledTimes(1);
  expect(text).toHaveFocus();
});

it('takes Shift+Tab from a programmatically focused heading to the last control', async () => {
  function Heading() {
    const layer = useModalLayer({ onClose: () => undefined });
    return <div {...layer}><div role="dialog"><h2 tabIndex={-1}>Heading</h2><button>First</button><button>Last</button></div></div>;
  }
  render(<Heading />);
  screen.getByRole('heading').focus();
  await userEvent.setup().tab({ shift: true });
  expect(screen.getByRole('button', { name: 'Last' })).toHaveFocus();
});

it('gives an already-open nested question keyboard ownership above its parent form', () => {
  const outer = jest.fn();
  const inner = jest.fn();
  // The real app's Tailwind CSS gives the confirmation the higher visual layer.
  const style = document.createElement('style');
  style.textContent = '[data-modal-layer] { z-index: 100 } [data-modal-layer].overflow-y-auto { z-index: 300 }';
  document.head.append(style);
  try {
    render(<FormDialog title="Parent" onClose={outer}><ConfirmModal isOpen title="Question" onClose={inner} onConfirm={() => undefined} /></FormDialog>);
    expect(screen.getByRole('dialog', { name: 'Question' })).toContainElement(document.activeElement as HTMLElement);
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    expect(inner).toHaveBeenCalledTimes(1);
    expect(outer).not.toHaveBeenCalled();
  } finally { style.remove(); }
});

it('treats the checked radio as the group Tab stop at the dialog boundary', async () => {
  function Radios() {
    const layer = useModalLayer({ onClose: () => undefined });
    return <div {...layer}><div role="dialog"><button>First</button><input type="radio" name="series" aria-label="Chosen" defaultChecked /><input type="radio" name="series" aria-label="Other" /></div></div>;
  }
  render(<Radios />);
  screen.getByRole('radio', { name: 'Chosen' }).focus();
  await userEvent.setup().tab();
  expect(screen.getByRole('button', { name: 'First' })).toHaveFocus();
});


it('yields keyboard ownership to a Headless UI dialog above a shared form', async () => {
  const parentClose = jest.fn();
  function Mixed() {
    const [open, setOpen] = useState(false);
    return <><FormDialog title="Parent" onClose={parentClose}><button onClick={() => setOpen(true)}>Details</button></FormDialog><Dialog open={open} onClose={() => setOpen(false)}><DialogPanel><DialogTitle>External</DialogTitle><button autoFocus>External first</button><button onClick={() => setOpen(false)}>External last</button></DialogPanel></Dialog></>;
  }
  const user = userEvent.setup();
  render(<Mixed />);
  await user.click(screen.getByRole('button', { name: 'Details' }));
  await screen.findByRole('dialog', { name: 'External' });
  screen.getByRole('button', { name: 'External last' }).focus();
  await user.tab();
  expect(screen.getByRole('button', { name: 'External first' })).toHaveFocus();
  await user.keyboard('{Escape}');
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'External' })).not.toBeInTheDocument());
  expect(screen.getByRole('dialog', { name: 'Parent' })).toBeInTheDocument();
  expect(parentClose).not.toHaveBeenCalled();
});

it.each([false, true])('keeps initial focus in a simultaneous external dialog (external first: %s)', async externalFirst => {
  const parentClose = jest.fn();
  function Simultaneous() {
    const initial = React.useRef<HTMLButtonElement>(null);
    const external = <Dialog key="external" open onClose={() => undefined} initialFocus={initial}><DialogPanel><DialogTitle>External</DialogTitle><button ref={initial}>External first</button><button>External last</button></DialogPanel></Dialog>;
    const parent = <FormDialog key="parent" title="Parent" onClose={parentClose}><input aria-label="Draft" /></FormDialog>;
    return <>{externalFirst ? [external, parent] : [parent, external]}</>;
  }
  render(<Simultaneous />);
  await waitFor(() => expect(screen.getByRole('button', { name: 'External first' })).toHaveFocus());
  screen.getByRole('button', { name: 'External last' }).focus();
  await userEvent.setup().tab();
  expect(screen.getByRole('button', { name: 'External first' })).toHaveFocus();
  expect(parentClose).not.toHaveBeenCalled();
});
