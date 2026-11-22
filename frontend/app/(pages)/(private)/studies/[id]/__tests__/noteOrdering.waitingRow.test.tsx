import { act, fireEvent, screen } from '@testing-library/react';
import { noteRef } from '@test-utils/deviceWorld';
import { stand, start, md, phoneSave, insert, finish, settle, hasNoteQuestion } from '@test-utils/noteOrdering';

const metadata = {
  title: { title: 'Phone title' }, tags: { tags: ['Phone tag'] }, type: { type: 'question' as const },
  scriptureRefs: { scriptureRefs: [{ id: 'r', bible: 'kjv' as const, book: 'John', chapter: 3, fromVerse: 16, toVerse: 16 }] },
  receipt: { dictationSourceIds: ['phone-source'], recordingSourceIds: ['phone-source'] },
};

it.each(Object.entries(metadata))('U112-01 adopts equal content plus %s without a redundant save of identical words', async (_field, fields) => {
  await start();
  const sends = jest.spyOn(stand.laptop.transport, 'send');
  act(() => insert(' Kword'));
  const k = md();
  // No durable debounce pause before the arrival: this is the original U112-01 boundary.
  await phoneSave(k, fields);
  await settle(2000);
  expect(stand.autosave).toMatchObject({ content: k, ...fields });
  expect(stand.confirmed).toMatchObject({ content: k, ...fields });
  expect(stand.autosave.baselineRef.current).toMatchObject({ content: k, ...fields });
  expect(screen.queryByText('common.saved')).toBeTruthy();
  expect(sends).not.toHaveBeenCalled();
  fireEvent.click(screen.getByTitle('common.done')); await settle();
  fireEvent.click(screen.getByTitle('common.edit')); await settle();
  expect(stand.autosave).toMatchObject(fields);
  act(() => insert(' Laterword')); await finish();
  expect(hasNoteQuestion()).toBe(false);
  expect(sends).toHaveBeenCalledTimes(1);
  expect((await stand.world.snapshot(noteRef)).value).toMatchObject({ content: k + ' Laterword', ...fields });
});

it.each(['title', 'refs'])('U112-01 stores a later %s edit without a question, as production does', async field => {
  await start();
  act(() => insert(' Kword'));
  await phoneSave(md(), field === 'title' ? metadata.title : metadata.scriptureRefs);
  await settle(2000);
  if (field === 'title') {
    expect(screen.getByPlaceholderText('studiesWorkspace.titlePlaceholder')).toHaveValue('Phone title');
    fireEvent.change(screen.getByPlaceholderText('studiesWorkspace.titlePlaceholder'), { target: { value: 'Later laptop title' } });
  } else {
    expect(stand.autosave.scriptureRefs).toEqual(metadata.scriptureRefs.scriptureRefs);
    fireEvent.change(screen.getByPlaceholderText('studiesWorkspace.quickRefPlaceholder'), { target: { value: 'John 1:1' } });
    fireEvent.keyDown(screen.getByPlaceholderText('studiesWorkspace.quickRefPlaceholder'), { key: 'Enter' });
  }
  await finish();
  expect(hasNoteQuestion()).toBe(false);
  const row = (await stand.world.snapshot(noteRef)).value!;
  if (field === 'title') expect(row.title).toBe('Later laptop title');
  else expect(row.scriptureRefs).toEqual(expect.arrayContaining([
    expect.objectContaining({ book: 'John', chapter: 3, fromVerse: 16 }),
    expect.objectContaining({ book: 'John', chapter: 1, fromVerse: 1 }),
  ]));
  expect(screen.queryByText('common.saved')).toBeTruthy();
});
