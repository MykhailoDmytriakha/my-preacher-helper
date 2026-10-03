import { actionFailureMessage } from '@/utils/actionFailureMessage';

describe('what a failed action says on screen', () => {
  afterEach(() => { jest.restoreAllMocks(); });

  it('shows a read-only refusal as it is: it already speaks the interface language', () => {
    const refusal = Object.assign(new Error('Память устройства не отвечает — только просмотр'), { code: 'read-only' });
    expect(actionFailureMessage(refusal, 'Could not save')).toBe('Память устройства не отвечает — только просмотр');
  });

  it('puts the action\'s own line in place of a developer sentence and keeps that sentence for the console', () => {
    const logged = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const engineError = new Error('The manual form is not ready');
    expect(actionFailureMessage(engineError, 'Could not save')).toBe('Could not save');
    expect(logged).toHaveBeenCalledWith(engineError);
    expect(actionFailureMessage('not even an error', 'Could not save')).toBe('Could not save');
  });
});
