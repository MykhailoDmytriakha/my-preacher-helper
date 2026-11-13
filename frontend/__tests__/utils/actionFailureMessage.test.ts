import { refusalKey, refusalWords, sayFailure } from '@/utils/actionFailureMessage';

import en from '../../locales/en/translation.json';
import ru from '../../locales/ru/translation.json';
import uk from '../../locales/uk/translation.json';

const t = (key: string) => key.split('.').reduce<unknown>((value, part) => (value as Record<string, unknown> | undefined)?.[part], en) as string ?? key;

// BUG-20261019-unavailable-refusal-in-english: a server that did not answer is said in the person's
// language, never with the transport's sentence for developers.
describe('refusalWords for a server that did not answer', () => {
  it.each(['unavailable', 'deadline-exceeded'])('says %s in the person\'s words', (code) => {
    const error = Object.assign(new Error('Data engine request failed'), { code });
    const said = sayFailure(refusalWords(error, 'dataSync.actionFailed'), t);
    expect(said).toBe(en.dataSync.failure.serverUnavailable);
    expect(said).not.toContain('Data engine');
    for (const locale of [en, ru, uk]) expect(locale.dataSync.failure.serverUnavailable).toBeTruthy();
  });

  it('keeps an unknown refusal\'s own sentence, which may be an instruction', () => {
    const error = Object.assign(new Error('Read the current document first'), { code: 'failed-precondition' });
    expect(sayFailure(refusalWords(error, 'dataSync.actionFailed'), t)).toBe('Read the current document first');
  });
});

// BUG-20261020-storage-error-said-raw: native exceptions are developer details, not instructions.
describe('technical exceptions from refused actions', () => {
  afterEach(() => { jest.restoreAllMocks(); });

  it.each([
    new DOMException("Failed to execute 'transaction' on 'IDBDatabase': The database connection is closing.", 'InvalidStateError'),
    new DOMException('Storage quota exceeded', 'QuotaExceededError'),
    new TypeError('Failed to fetch'),
    new SyntaxError('Unexpected token in stored data'),
  ])('uses the caller wording for $name in every interface language', error => {
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const words = refusalWords(error, 'dataSync.actionFailed');
    expect(words).toEqual({ key: 'dataSync.actionFailed' });
    for (const locale of [en, ru, uk]) {
      const translate = (key: string) => key.split('.').reduce<unknown>((value, part) => (value as Record<string, unknown> | undefined)?.[part], locale) as string ?? key;
      expect(sayFailure(words, translate)).toBe(locale.dataSync.actionFailed);
    }
  });

  it('logs the original native exception once without keeping its sentence as UI words', () => {
    const logged = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const error = new DOMException('Native storage details', 'InvalidStateError');
    refusalWords(error, 'dataSync.actionFailed');
    refusalWords(error, 'dataSync.actionFailed');
    expect(logged).toHaveBeenCalledTimes(1);
    expect(logged).toHaveBeenCalledWith(error);
  });

  it('keeps an explicit domain refusal even when its underlying class is native', () => {
    const refusal = Object.assign(new TypeError('Read the current document first'), { code: 'failed-precondition' });
    expect(sayFailure(refusalWords(refusal, 'dataSync.actionFailed'), t)).toBe(refusal.message);
  });
});


it.each([['en', en], ['ru', ru], ['uk', uk]])('uses %s words when an earlier action needs a version decision', (_name, locale) => {
  const error = Object.assign(new Error('An earlier change to this document waits for a decision'), { code: 'decision-required' });
  const translate = (key: string) => key.split('.').reduce<unknown>((value, part) =>
    (value as Record<string, unknown> | undefined)?.[part], locale) as string ?? key;
  expect(sayFailure(refusalWords(error, 'common.saveError'), translate)).toBe(locale.dataSync.failure.decisionRequired);
});

it.each([['en', en], ['ru', ru], ['uk', uk]])('explains a changed saved decision in %s', (_name, locale) => {
  const error = Object.assign(new Error('Commit changed'), { code: 'commit-changed' });
  const words = refusalWords(error, 'common.saveError');
  expect(words).toEqual({ key: 'dataSync.failure.savedWorkChanged' });
  const translate = (key: string) => key.split('.').reduce<unknown>((value, part) =>
    (value as Record<string, unknown> | undefined)?.[part], locale) as string ?? key;
  expect(sayFailure(words, translate)).not.toBe('dataSync.failure.savedWorkChanged');
});

it.each([['en', en], ['ru', ru], ['uk', uk]])('says in %s that a text too large for one save stays as a draft', (_name, locale) => {
  const error = Object.assign(new Error('Command exceeds the size limit'), { code: 'resource-exhausted' });
  const translate = (key: string) => key.split('.').reduce<unknown>((value, part) =>
    (value as Record<string, unknown> | undefined)?.[part], locale) as string ?? key;
  const sentence = (locale.dataSync.failure as Record<string, string>).tooLargeToSave;
  expect(sentence).toBeTruthy();
  expect(refusalKey('resource-exhausted')).toBe('dataSync.failure.tooLargeToSave');
  expect(sayFailure(refusalWords(error, 'common.saveError'), translate)).toBe(sentence);
});
