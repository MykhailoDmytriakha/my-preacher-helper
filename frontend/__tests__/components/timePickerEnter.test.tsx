import { fireEvent, render, screen } from '@testing-library/react';

import CustomTimePicker from '@/components/CustomTimePicker';
import SectionTimePicker from '@/components/SectionTimePicker';

/**
 * A key pressed on an inner control belongs to that control (.howto/fix-a-click-that-misfires.md).
 * The pickers' dialogs confirm on Enter, and they used to take it from every button inside:
 * Enter on Cancel, Back or a preset confirmed the time, and Enter on the confirm button confirmed
 * twice — once from the dialog, once from the button's own click. Under jsdom a key does not
 * press a button, so the button's own action is fired as the click a browser would make.
 */
const pickers = [
  {
    name: 'CustomTimePicker',
    renderPicker: (props: { onConfirm: jest.Mock; onCancel: jest.Mock; onBack: jest.Mock }) =>
      render(<CustomTimePicker {...props} />),
  },
  {
    name: 'SectionTimePicker',
    renderPicker: (props: { onConfirm: jest.Mock; onCancel: jest.Mock; onBack: jest.Mock }) =>
      render(<SectionTimePicker initialDurations={{ introduction: 120, main: 900, conclusion: 180 }} {...props} />),
  },
];

describe.each(pickers)('$name: Enter inside the dialog', ({ renderPicker }) => {
  // The wheels scroll to the chosen value on open; jsdom has no scrolling.
  beforeAll(() => {
    Element.prototype.scrollTo = jest.fn() as unknown as typeof Element.prototype.scrollTo;
  });
  const setup = () => {
    const props = { onConfirm: jest.fn(), onCancel: jest.fn(), onBack: jest.fn() };
    renderPicker(props);
    return props;
  };
  const footerButton = (name: RegExp) => screen.getAllByRole('button', { name }).at(-1)!;

  it('leaves Enter on Cancel, Back and a preset to those buttons', () => {
    const { onConfirm } = setup();
    fireEvent.keyDown(footerButton(/common\.cancel/), { key: 'Enter' });
    fireEvent.keyDown(screen.getByRole('button', { name: /common\.back/ }), { key: 'Enter' });
    fireEvent.keyDown(screen.getAllByRole('button', { name: /^\d+m$/ })[0], { key: 'Enter' });

    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('confirms once when Enter lands on the confirm button', () => {
    const { onConfirm } = setup();
    const confirm = screen.getByRole('button', { name: /plan\.setTime/ });
    fireEvent.keyDown(confirm, { key: 'Enter' });
    fireEvent.click(confirm);

    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('still confirms on Enter pressed on the dialog itself', () => {
    const { onConfirm } = setup();
    fireEvent.keyDown(screen.getByRole('heading', { level: 2 }), { key: 'Enter' });

    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  // Escape belongs to the shared modal layer (useModalLayer: only the topmost window answers).
  // The pickers also closed themselves on Escape inside React — twice here, and in a browser the
  // timer's shortcuts came back on mid-press and the same Escape left the preaching view.
  it('closes once on Escape, through the shared modal layer', () => {
    const { onCancel } = setup();
    fireEvent.keyDown(footerButton(/common\.cancel/), { key: 'Escape' });

    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
