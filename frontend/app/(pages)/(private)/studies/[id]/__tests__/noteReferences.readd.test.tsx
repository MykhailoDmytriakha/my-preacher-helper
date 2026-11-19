import { act, fireEvent, screen } from '@testing-library/react';

import { noteRef } from '@test-utils/deviceWorld';
import { finish, hasGlobalNotice, hasInlineQuestion, insert, stand, start, stored } from '@test-utils/noteOrdering';

// The study-note page sends no reference evidence yet, so the server's removal journal must not turn its own
// re-added passage into a version question (BUG-20261118-note-page-codex-fixes-wait-for-engine-session).
// Found by the independent review of the 18.11 intake of the Codex branch.
const storedReferences = async () => JSON.stringify(((await stand.world.snapshot(noteRef)).value!.scriptureRefs as Array<Record<string, unknown>>)
  .map(({ id: _id, ...reference }) => reference));
const addReference = async (text: string) => {
  await act(async () => { fireEvent.change(screen.getByPlaceholderText('studiesWorkspace.quickRefPlaceholder'), { target: { value: text } }); });
  await act(async () => { fireEvent.keyDown(screen.getByPlaceholderText('studiesWorkspace.quickRefPlaceholder'), { key: 'Enter' }); });
  await finish();
};

it('re-adds a passage it removed on the same device without a question, and keeps saving later words', async () => {
  await start();
  await addReference('John 3:16');
  const added = await storedReferences();
  expect(added).toContain('John');

  await act(async () => { fireEvent.click(screen.getAllByRole('button', { name: 'studiesWorkspace.removeReference' })[0]); });
  await finish();
  expect(await storedReferences()).toBe('[]');

  await addReference('John 3:16');
  expect(await storedReferences()).toBe(added);
  expect(hasInlineQuestion()).toBe(false);
  expect(hasGlobalNotice()).toBe(false);

  act(() => insert(' Laterword'));
  await finish();
  expect(await stored()).toContain('Laterword');
}, 60000);
