import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import EditThoughtModal from '@/components/EditThoughtModal';

jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string, options?: { tag?: string }) => {
  if (key === 'thought.addTagAria') return `Add tag ${options?.tag}`;
  if (key === 'thought.removeTagAria') return `Remove tag ${options?.tag}`;
  return key;
} }) }));
jest.mock('@/providers/ConnectionProvider', () => ({ useConnection: () => ({ isOnline: true, isMagicAvailable: true }) }));
jest.mock('@/components/ui/RichMarkdownEditor', () => ({ RichMarkdownEditor: ({ value, onChange }: { value: string; onChange: (value: string) => void }) => <textarea aria-label="Draft" value={value} onChange={event => onChange(event.target.value)} /> }));
jest.mock('@/components/FocusRecorderButton', () => ({ FocusRecorderButton: () => null }));

function openEditor() {
  const save = jest.fn();
  const allowedTags = [{ name: 'Custom', color: '#336699' }];
  render(<EditThoughtModal initialText="Draft" initialTags={[]} allowedTags={allowedTags} onClose={jest.fn()} onSave={save} />);
  return save;
}

it.each([['Enter'], [' ']] as const)('supports edit tag selection and removal with the %s key', key => {
  openEditor();
  const add = screen.getByRole('button', { name: 'Add tag Custom' });
  expect(add).toHaveAttribute('tabindex', '0');
  add.focus();
  expect(add).toHaveFocus();
  fireEvent.keyDown(add, { key });
  const remove = screen.getByRole('button', { name: 'Remove tag Custom' });
  fireEvent.keyDown(remove, { key });
  expect(screen.getByRole('button', { name: 'Add tag Custom' })).toBeInTheDocument();
});

it('preserves the edit pointer selection and exact saved tag payload', async () => {
  const save = openEditor();
  fireEvent.change(screen.getByRole('textbox', { name: 'Draft' }), { target: { value: 'Updated draft' } });
  fireEvent.click(screen.getByRole('button', { name: 'Add tag Custom' }));
  fireEvent.click(screen.getByRole('button', { name: 'buttons.save' }));
  await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
  expect(save).toHaveBeenCalledWith('Updated draft', ['Custom'], undefined, null);
});
