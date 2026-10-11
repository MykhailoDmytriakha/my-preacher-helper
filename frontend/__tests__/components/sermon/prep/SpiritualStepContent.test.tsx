import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import '@testing-library/jest-dom';

jest.mock('@locales/i18n', () => ({}));

import SpiritualStepContent from '@/components/sermon/prep/SpiritualStepContent';

describe('SpiritualStepContent', () => {
  const setup = (checked = false) => {
    const savePreparation = jest.fn();
    const formatSuperscriptVerses = (s: string) => s;
    render(
      <SpiritualStepContent
        prepDraft={{ spiritual: { readAndPrayedConfirmed: checked } }}
        setPrepDraft={() => {}}
        savePreparation={savePreparation}
        formatSuperscriptVerses={formatSuperscriptVerses}
      />
    );
    return { savePreparation };
  };

  it('toggles readAndPrayed checkbox and saves', () => {
    const { savePreparation } = setup(false);
    const checkbox = screen.getByRole('checkbox');
    fireEvent.click(checkbox);
    expect(savePreparation).toHaveBeenCalled();
  });
});


