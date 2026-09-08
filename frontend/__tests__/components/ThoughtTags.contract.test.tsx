import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import CreateThoughtModal from '@/components/CreateThoughtModal';
import EditThoughtModal from '@/components/EditThoughtModal';

jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string, options?: { tag?: string }) => {
  if (key === 'thought.addTagAria') return `Add tag ${options?.tag}`;
  if (key === 'thought.removeTagAria') return `Remove tag ${options?.tag}`;
  return key;
} }) }));
jest.mock('@/providers/ConnectionProvider', () => ({ useConnection: () => ({ isOnline: true, isMagicAvailable: true }) }));
jest.mock('@/components/ui/RichMarkdownEditor', () => ({ RichMarkdownEditor: ({ value, onChange }: { value: string; onChange: (value: string) => void }) => <textarea aria-label="Draft" value={value} onChange={event => onChange(event.target.value)} /> }));
jest.mock('@/components/FocusRecorderButton', () => ({ FocusRecorderButton: () => null }));

function openEditor(kind: 'create' | 'edit') {
  const save = jest.fn();
  const allowedTags = [{ name: 'Custom', color: '#336699' }];
  if (kind === 'create') render(<CreateThoughtModal isOpen onClose={jest.fn()} onCreateThought={save} allowedTags={allowedTags} />);
  else render(<EditThoughtModal initialText="Draft" initialTags={[]} allowedTags={allowedTags} onClose={jest.fn()} onSave={save} />);
  return save;
}

it.each([['create', 'Enter'], ['create', ' '], ['edit', 'Enter'], ['edit', ' ']] as const)('supports %s tag selection and removal with the %s key', (kind, key) => {
  openEditor(kind);
  const add = screen.getByRole('button', { name: 'Add tag Custom' });
  expect(add).toHaveAttribute('tabindex', '0');
  add.focus();
  expect(add).toHaveFocus();
  fireEvent.keyDown(add, { key });
  const remove = screen.getByRole('button', { name: 'Remove tag Custom' });
  fireEvent.keyDown(remove, { key });
  expect(screen.getByRole('button', { name: 'Add tag Custom' })).toBeInTheDocument();
});

it.each(['create', 'edit'] as const)('preserves the %s pointer selection and exact saved tag payload', async kind => {
  const save = openEditor(kind);
  fireEvent.change(screen.getByRole('textbox', { name: 'Draft' }), { target: { value: 'Updated draft' } });
  fireEvent.click(screen.getByRole('button', { name: 'Add tag Custom' }));
  fireEvent.click(screen.getByRole('button', { name: 'buttons.save' }));
  await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
  if (kind === 'create') expect(save).toHaveBeenCalledWith(expect.objectContaining({ text: 'Updated draft', tags: ['Custom'], outlinePointId: undefined }));
  else expect(save).toHaveBeenCalledWith('Updated draft', ['Custom'], undefined, null);
});
