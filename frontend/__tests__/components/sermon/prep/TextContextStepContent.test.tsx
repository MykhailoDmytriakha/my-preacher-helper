import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';

jest.mock('@locales/i18n', () => ({}));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => k }) }));

import TextContextStepContent from '@/components/sermon/prep/TextContextStepContent';

describe('TextContextStepContent', () => {
  const setup = () => {
    const onSaveVerse = jest.fn();
    const onToggleReadWholeBookOnce = jest.fn();
    const onSaveContextNotes = jest.fn();
    const onSaveRepeatedWords = jest.fn();

    render(
      <TextContextStepContent
        initialVerse="John 3:16"
        onSaveVerse={onSaveVerse}
        readWholeBookOnceConfirmed={false}
        onToggleReadWholeBookOnce={onToggleReadWholeBookOnce}
        initialContextNotes=""
        onSaveContextNotes={onSaveContextNotes}
        initialRepeatedWords={['faith']}
        onSaveRepeatedWords={onSaveRepeatedWords}
      />
    );

    return { onSaveVerse, onToggleReadWholeBookOnce, onSaveContextNotes, onSaveRepeatedWords };
  };

  it('saves verse when changed and save clicked', async () => {
    const { onSaveVerse } = setup();
    const input = screen.getByLabelText('wizard.steps.textContext.passageInput.label');
    fireEvent.change(input, { target: { value: 'Romans 8:14' } });

    const saveBtn = await screen.findByRole('button', { name: /actions.save/i });
    fireEvent.click(saveBtn);

    await waitFor(() => expect(onSaveVerse).toHaveBeenCalledWith('Romans 8:14'));
  });

  it('toggles readWholeBookOnce checkbox', () => {
    const { onToggleReadWholeBookOnce } = setup();
    const checkbox = screen.getByRole('checkbox');
    fireEvent.click(checkbox);
    expect(onToggleReadWholeBookOnce).toHaveBeenCalledWith(true);
  });

  it('saves context notes', async () => {
    const { onSaveContextNotes } = setup();
    const textarea = screen.getByLabelText('wizard.steps.textContext.contextInput.label');
    fireEvent.change(textarea, { target: { value: 'Short context' } });

    const saveBtn = await screen.findByRole('button', { name: /actions.save/i });
    fireEvent.click(saveBtn);

    await waitFor(() => expect(onSaveContextNotes).toHaveBeenCalledWith('Short context'));
  });

  it('saves repeated words as array', async () => {
    const { onSaveRepeatedWords } = setup();
    const input = screen.getByLabelText('wizard.steps.textContext.repeatedInput.label');
    fireEvent.change(input, { target: { value: 'a, b , , c' } });

    const saveBtn = await screen.findByRole('button', { name: /actions.save/i });
    fireEvent.click(saveBtn);

    await waitFor(() => expect(onSaveRepeatedWords).toHaveBeenCalledWith(['a', 'b', 'c']));
  });
});


