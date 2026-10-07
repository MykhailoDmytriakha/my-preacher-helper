import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';

import EditableTitle from '@/components/common/EditableTitle';
import '@testing-library/jest-dom';

/**
 * AN ERROR ON SCREEN SPEAKS THE LANGUAGE ON SCREEN (BUG-20261006-screen-error-kept-as-translated-sentence).
 * The title kept its save failure as a sentence translated when the save failed; after the person
 * switched the language it stayed in the old one. Each `t` here speaks the language it was handed out
 * in, as i18next's does after a switch, so a sentence kept from before the switch shows its old prefix.
 */
let language = 'ru';
jest.mock('react-i18next', () => ({ useTranslation: () => { const spoken = language; return { t: (key: string) => `${spoken}:${key}` }; } }));

it('says a failed save in the language chosen after it', async () => {
  const onSave = jest.fn().mockRejectedValue(new Error('offline'));
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
  const view = render(<EditableTitle initialTitle="Grace" onSave={onSave} />);
  fireEvent.click(screen.getByTitle('ru:common.edit'));
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Grace upon grace' } });
  fireEvent.click(screen.getByTitle('ru:common.save'));
  await waitFor(() => expect(screen.getByText('ru:errors.failedToSaveTitle')).toBeInTheDocument());

  language = 'en';
  view.rerender(<EditableTitle initialTitle="Grace" onSave={onSave} />);

  expect(screen.getByText('en:errors.failedToSaveTitle')).toBeInTheDocument();
  expect(screen.queryByText('ru:errors.failedToSaveTitle')).not.toBeInTheDocument();
});
