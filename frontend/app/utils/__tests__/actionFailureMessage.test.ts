import { actionFailureMessage } from '@/utils/actionFailureMessage';

const t = (key: string) => `translated:${key}`;

describe('what a failed action says on screen', () => {
  afterEach(() => { jest.restoreAllMocks(); });

  it('shows a read-only refusal as it is: it already speaks the interface language', () => {
    const refusal = Object.assign(new Error('Память устройства не отвечает — только просмотр'), { code: 'read-only' });
    expect(actionFailureMessage(refusal, t, 'council.save.refused')).toBe('Память устройства не отвечает — только просмотр');
  });

  it('puts the action\'s own line in place of a developer sentence and keeps that sentence for the console', () => {
    const logged = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const engineError = new Error('The manual form is not ready');
    expect(actionFailureMessage(engineError, t, 'council.save.refused')).toBe('translated:council.save.refused');
    expect(logged).toHaveBeenCalledWith(engineError);
    expect(actionFailureMessage('not even an error', t, 'council.save.refused')).toBe('translated:council.save.refused');
  });
});
