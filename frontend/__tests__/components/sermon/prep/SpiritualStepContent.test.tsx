import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import '@testing-library/jest-dom';

jest.mock('@locales/i18n', () => ({}));

import SpiritualStepContent from '@/components/sermon/prep/SpiritualStepContent';

describe('SpiritualStepContent', () => {
  const setup = (saving = false, checked = false) => {
    const savePreparation = jest.fn();
    const formatSuperscriptVerses = (s: string) => s;
    render(
      <SpiritualStepContent
        prepDraft={{ spiritual: { readAndPrayedConfirmed: checked } }}
        setPrepDraft={() => {}}
        savePreparation={savePreparation}
        savingPrep={saving}
        formatSuperscriptVerses={formatSuperscriptVerses}
      />
    );
    return { savePreparation };
  };

  it('toggles readAndPrayed checkbox and saves', () => {
    const { savePreparation } = setup(false, false);
    const checkbox = screen.getByRole('checkbox');
    fireEvent.click(checkbox);
    expect(savePreparation).toHaveBeenCalled();
  });

  it('shows saving state text', () => {
    setup(true, true);
    expect(screen.getByText(/Сохранение|Saving/i)).toBeInTheDocument();
  });
});


