import { render } from '@testing-library/react';
import React from 'react';
import { I18nextProvider } from 'react-i18next';
import '@testing-library/jest-dom';

import SpiritualStepContent from '@/components/sermon/prep/SpiritualStepContent';
import i18n from '@locales/i18n';

// The real libraries: the shared setup replaces both with stand-ins that have no language at all.
jest.mock('i18next', () => jest.requireActual('i18next'));
jest.mock('react-i18next', () => jest.requireActual('react-i18next'));

/**
 * THE FIRST PREPARATION STEP SPEAKS THE INTERFACE LANGUAGE (BUG-20261011-spiritual-step-hardcoded-russian).
 *
 * The step was written in Russian straight into the component, so English and Ukrainian interfaces
 * showed Russian headings, a Russian prayer checkbox and the Russian Synodal reading. The owner chose
 * the translations of the reading (2026-10-11): KJV for English, Ohienko for Ukrainian.
 */
const sup = (text: string) => text.replace(/(^|\s)(\d{1,3})(?=\s)/g, '$1<sup>$2</sup>');

function renderStep(language: string, confirmed = false) {
  void i18n.changeLanguage(language);
  return render(
    <I18nextProvider i18n={i18n}>
      <SpiritualStepContent
        prepDraft={{ spiritual: { readAndPrayedConfirmed: confirmed } }}
        setPrepDraft={() => undefined}
        savePreparation={() => undefined}
        formatSuperscriptVerses={sup}
      />
    </I18nextProvider>
  );
}

const underlined = (container: HTMLElement) => [...container.querySelectorAll('u')].map(u => u.textContent?.trim());

describe('the spiritual preparation step in each interface language', () => {
  afterAll(() => { void i18n.changeLanguage('ru'); });

  it('reads Jeremiah 23 from the KJV in English, with no Russian on screen', () => {
    const { container } = renderStep('en');
    expect(container.textContent).not.toMatch(/[А-Яа-яЁё]/);
    expect(container.textContent).toContain('Mine heart within me is broken because of the prophets');
    expect(container.textContent).toContain('(Jeremiah 23:9-32)');
    expect(underlined(container)).toEqual([
      'Hearken not unto the words of the prophets that prophesy unto you: they make you vain: they speak a vision of their own heart, and not out of the mouth of the LORD.',
      'But if they had stood in my counsel, and had caused my people to hear my words, then they should have turned them from their evil way, and from the evil of their doings.',
      'The prophet that hath a dream, let him tell a dream; and he that hath my word, let him speak my word faithfully.',
      'Is not my word like as a fire? saith the LORD; and like a hammer that breaketh the rock in pieces?',
    ]);
    expect(container.textContent).toContain('So they read in the book in the law of God distinctly');
    expect(container.textContent).toContain('Mark when you have read and prayed');
  });

  it('reads Jeremiah 23 from the Ohienko translation in Ukrainian, with no Russian letters', () => {
    const { container } = renderStep('uk');
    expect(container.textContent).not.toMatch(/[ЫыЭэЪъЁё]/);
    expect(container.textContent).toContain('Розривається серце моє в моїм нутрі');
    expect(underlined(container)).toHaveLength(4);
    expect(underlined(container)[0]).toBe('Не слухайте слів цих пророків, що вам пророкують, — вони роблять безглуздими вас, висловлюють привиди серця свого, а не слово з уст Господніх.');
    expect(container.textContent).toContain('І читали в книзі, у Божому Законі виразно');
    expect(container.textContent).toContain('не поможуть народові цьому, говорить Господь. (Єр. 23:9-32)');
    // The source module splits one word here ("про років"); the screen must read it whole.
    expect(container.textContent).toContain('А в тих самарійських пророків Я бачив безглуздя');
    expect(container.textContent).not.toContain('про років');
  });

  it('keeps the Synodal reading and its underlined verses in Russian', () => {
    const { container } = renderStep('ru');
    expect(container.textContent).toContain('Сердце мое во мне раздирается');
    expect(underlined(container)).toHaveLength(4);
    expect(container.textContent).toContain('Отметьте, когда прочитали и помолились');
  });

  it('says nothing about saving when all is well', () => {
    const { container } = renderStep('en', true);
    expect(container.textContent).not.toMatch(/Saving|Saved/);
    expect(container.textContent).toContain('Step done: Scripture read, prayer offered');
  });
});
