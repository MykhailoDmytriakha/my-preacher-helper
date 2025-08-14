import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';

jest.mock('@locales/i18n', () => ({}));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => k }) }));

import MainIdeaStepContent from '@/components/sermon/prep/MainIdeaStepContent';

describe('MainIdeaStepContent', () => {
  it('renders sections using translation keys', () => {
    render(<MainIdeaStepContent />);
    expect(screen.getByText('wizard.steps.mainIdea.note.title')).toBeInTheDocument();
    expect(screen.getByText('wizard.steps.mainIdea.contextIdea.title')).toBeInTheDocument();
    expect(screen.getByText('wizard.steps.mainIdea.textIdea.title')).toBeInTheDocument();
    expect(screen.getByText('wizard.steps.mainIdea.argumentation.title')).toBeInTheDocument();
  });
});


