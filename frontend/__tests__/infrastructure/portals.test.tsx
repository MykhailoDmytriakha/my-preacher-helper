import { fireEvent, render, screen } from '@testing-library/react';
import { createContext, useContext, useState } from 'react';
import { createPortal } from 'react-dom';

const Owner = createContext('missing context');
function Editor() {
  const owner = useContext(Owner);
  const [text, setText] = useState('Draft');
  const [nested, setNested] = useState(false);
  return <><p>{owner}</p><input aria-label="Draft" value={text} onChange={e => setText(e.target.value)} /><button onClick={() => setNested(!nested)}>Toggle picker</button>
    {nested && createPortal(<div role="dialog" aria-label="Picker">Custom color</div>, document.body)}</>;
}
function Dialog() { return createPortal(<section role="dialog" aria-label="Editor"><Editor /></section>, document.body); }

it('preserves provider context and draft state when nested portals open and close', () => {
  const { container, unmount } = render(<Owner.Provider value="Signed-in owner"><Dialog /></Owner.Provider>);
  expect(screen.getByText('Signed-in owner')).toBeInTheDocument();
  expect(container).not.toContainElement(screen.getByRole('dialog', { name: 'Editor' }));
  const input = screen.getByRole('textbox', { name: 'Draft' });
  fireEvent.change(input, { target: { value: 'My exact text' } });
  fireEvent.click(screen.getByRole('button', { name: 'Toggle picker' }));
  expect(screen.getAllByRole('dialog')).toHaveLength(2);
  expect(input).toHaveValue('My exact text');
  fireEvent.click(screen.getByRole('button', { name: 'Toggle picker' }));
  expect(screen.queryByRole('dialog', { name: 'Picker' })).not.toBeInTheDocument();
  expect(screen.getByRole('textbox')).toBe(input);
  unmount();
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});

it('lets normal test cleanup unmount a portal before deleting its DOM', () => {
  render(<Owner.Provider value="Another owner"><Dialog /></Owner.Provider>);
  expect(screen.getByText('Another owner')).toBeInTheDocument();
});
