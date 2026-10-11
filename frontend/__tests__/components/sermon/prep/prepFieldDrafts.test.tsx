import { fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import '@testing-library/jest-dom';

jest.mock('@locales/i18n', () => ({}));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => k }) }));

import AuthorIntentSection from '@/components/sermon/prep/exegeticalPlan/AuthorIntentSection';
import ExegeticalPlanModule from '@/components/sermon/prep/exegeticalPlan/ExegeticalPlanModule';
import GoalsStepContent from '@/components/sermon/prep/GoalsStepContent';
import HomileticPlanStepContent from '@/components/sermon/prep/HomileticPlanStepContent';
import MainIdeaStepContent from '@/components/sermon/prep/MainIdeaStepContent';
import TextContextStepContent from '@/components/sermon/prep/TextContextStepContent';
import ThesisStepContent from '@/components/sermon/prep/ThesisStepContent';

void AuthorIntentSection;

/**
 * A PREPARATION FIELD KEEPS WHAT IS BEING TYPED (BUG-20261011-prep-field-draft-replaced-by-parent-copy).
 *
 * Every field with its own Save button replaced its draft whenever the sermon's copy of that field
 * changed — another device saved it, a late load arrived — so words typed and not yet saved
 * vanished. The rule: the draft follows the stored value only while the person has not typed in it;
 * typed words stay until saved or cancelled. A field nobody touched still shows the newer copy.
 */
type Case = {
  name: string;
  placeholder: string;
  render: (value: string) => React.ReactElement;
};

const cases: Case[] = [
  {
    name: 'main idea of the context',
    placeholder: 'wizard.steps.mainIdea.contextIdea.placeholder',
    render: value => <MainIdeaStepContent initialContextIdea={value} onSaveContextIdea={jest.fn()} />,
  },
  {
    name: 'timeless truth',
    placeholder: 'wizard.steps.goals.timelessTruth.placeholder',
    render: value => <GoalsStepContent initialTimelessTruth={value} onSaveTimelessTruth={jest.fn()} />,
  },
  {
    name: 'passage summary',
    placeholder: 'wizard.steps.textContext.passageSummary.placeholder',
    render: value => <TextContextStepContent initialVerse="John 1:1" onSaveVerse={jest.fn()} initialPassageSummary={value} onSavePassageSummary={jest.fn()} />,
  },
  {
    name: 'exegetical thesis',
    placeholder: 'wizard.steps.thesis.exegetical.placeholder',
    render: value => <ThesisStepContent exegetical={value} onSaveExegetical={jest.fn()} />,
  },
  {
    name: 'modern translation',
    placeholder: 'wizard.steps.homileticPlan.fields.modernTranslation.placeholder',
    render: value => <HomileticPlanStepContent initialModernTranslation={value} onSaveModernTranslation={jest.fn()} />,
  },
  {
    name: "author's intent",
    placeholder: 'wizard.steps.exegeticalPlan.authorIntent.placeholder',
    render: value => <ExegeticalPlanModule value={[]} onEdit={jest.fn()} authorIntent={value} onSaveAuthorIntent={jest.fn()} />,
  },
];

describe.each(cases)('the $name field', ({ placeholder, render: field }) => {
  it('keeps unsaved words when a newer copy of the field arrives', () => {
    const view = render(field('Stored words'));
    fireEvent.change(screen.getByPlaceholderText(placeholder), { target: { value: 'Stored words and mine' } });
    view.rerender(field('Written on the phone'));
    expect(screen.getByPlaceholderText(placeholder)).toHaveValue('Stored words and mine');
  });

  it('shows a newer copy while nobody has typed in it', () => {
    const view = render(field('Stored words'));
    view.rerender(field('Written on the phone'));
    expect(screen.getByPlaceholderText(placeholder)).toHaveValue('Written on the phone');
  });

  it('follows the next copy again once the typed words are saved', () => {
    const view = render(field('Stored words'));
    fireEvent.change(screen.getByPlaceholderText(placeholder), { target: { value: 'Saved here' } });
    view.rerender(field('Saved here'));
    view.rerender(field('Written on the phone'));
    expect(screen.getByPlaceholderText(placeholder)).toHaveValue('Written on the phone');
  });
});

describe('a field whose Save stores a cleaned-up value', () => {
  const summary = (value: string, onSave = jest.fn()) => (
    <TextContextStepContent initialVerse="John 1:1" onSaveVerse={jest.fn()} initialPassageSummary={value} onSavePassageSummary={onSave} />
  );
  const repeated = (words: string[]) => (
    <TextContextStepContent initialVerse="John 1:1" onSaveVerse={jest.fn()} initialRepeatedWords={words} onSaveRepeatedWords={jest.fn()} />
  );

  it('follows the next copy after a save trimmed the words', () => {
    const view = render(summary('Stored'));
    fireEvent.change(screen.getByPlaceholderText('wizard.steps.textContext.passageSummary.placeholder'), { target: { value: '  Mine  ' } });
    fireEvent.click(screen.getByTitle('actions.save'));
    view.rerender(summary('Mine'));
    view.rerender(summary('Written on the phone'));
    expect(screen.getByPlaceholderText('wizard.steps.textContext.passageSummary.placeholder')).toHaveValue('Written on the phone');
  });

  it('follows the next copy after a save tidied a list of words', () => {
    const view = render(repeated(['old']));
    fireEvent.change(screen.getByPlaceholderText('wizard.steps.textContext.repeatedInput.placeholder'), { target: { value: 'a,b , , c' } });
    fireEvent.click(screen.getByTitle('actions.save'));
    view.rerender(repeated(['a', 'b', 'c']));
    view.rerender(repeated(['from', 'phone']));
    expect(screen.getByPlaceholderText('wizard.steps.textContext.repeatedInput.placeholder')).toHaveValue('from, phone');
  });
});

describe('Cancel', () => {
  it("brings back the stored author's intent and keeps following it", () => {
    const planStep = (value: string) => <ExegeticalPlanModule value={[]} onEdit={jest.fn()} authorIntent={value} onSaveAuthorIntent={jest.fn()} />;
    const view = render(planStep('Stored intent'));
    const field = () => screen.getByPlaceholderText('wizard.steps.exegeticalPlan.authorIntent.placeholder');
    fireEvent.change(field(), { target: { value: 'Mine' } });
    fireEvent.click(screen.getByRole('button', { name: 'actions.cancel' }));
    expect(field()).toHaveValue('Stored intent');
    view.rerender(planStep('Written on the phone'));
    expect(field()).toHaveValue('Written on the phone');
  });

  it('brings back the current verse, not the one the page opened with', () => {
    const step = (verse: string) => <TextContextStepContent initialVerse={verse} onSaveVerse={jest.fn()} />;
    const view = render(step('John 1:1'));
    view.rerender(step('John 3:16'));
    const field = () => screen.getByPlaceholderText('wizard.steps.textContext.passageInput.placeholder');
    fireEvent.change(field(), { target: { value: 'Mine' } });
    fireEvent.click(screen.getByTitle('actions.cancel'));
    expect(field()).toHaveValue('John 3:16');
    view.rerender(step('Romans 8:14'));
    expect(field()).toHaveValue('Romans 8:14');
  });
});

describe('edge cases found in review', () => {
  it('lets a cleared verse be cancelled back to the current one', () => {
    const step = (verse: string) => <TextContextStepContent initialVerse={verse} onSaveVerse={jest.fn()} />;
    const view = render(step('John 3:16'));
    const field = () => screen.getByPlaceholderText('wizard.steps.textContext.passageInput.placeholder');
    fireEvent.change(field(), { target: { value: '' } });
    expect(screen.getByTitle('actions.save')).toBeDisabled();
    fireEvent.click(screen.getByTitle('actions.cancel'));
    view.rerender(step('Romans 8:14'));
    expect(field()).toHaveValue('Romans 8:14');
  });

  it('follows the next copy after a save whose echo writes the same points with fields in another order', () => {
    type Item = { id: string; title: string };
    const step = (items: Item[]) => <HomileticPlanStepContent initialUpdatedPlan={items} onSaveUpdatedPlan={jest.fn()} />;
    const view = render(step([{ id: '1', title: 'One' }]));
    fireEvent.change(screen.getByDisplayValue('One'), { target: { value: 'Mine' } });
    view.rerender(step([{ title: 'Mine', id: '1' } as Item]));
    view.rerender(step([{ id: '1', title: 'From the phone' }]));
    expect(screen.getByDisplayValue('From the phone')).toBeInTheDocument();
  });
});
