import { refusalWords, sayFailure } from '@/utils/actionFailureMessage';

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
