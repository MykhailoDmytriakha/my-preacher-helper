import { act, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';

import { useConfirm, type ConfirmOptions } from '@/hooks/useConfirm';
import '@testing-library/jest-dom';

// English says the default or the key; another language prefixes the key and lists the values,
// so a test can switch the language under an open question.
let mockLanguage = 'en';
jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, o?: Record<string, string>) => {
      if (mockLanguage === 'en') return o?.defaultValue ?? key;
      const values = Object.entries(o ?? {}).filter(([name]) => name !== 'defaultValue').map(([name, value]) => ` ${name}=${value}`);
      return `${mockLanguage}:${key}${values.join('')}`;
    },
  }),
}));

/**
 * THE QUESTION BEFORE AN IRREVERSIBLE STEP, ASKED IN THE APP'S OWN WINDOW.
 */
function Asker({ options, onAnswer }: { options: ConfirmOptions; onAnswer: (answer: boolean) => void }) {
  const { confirm, confirmDialog } = useConfirm();
  return (
    <>
      <button type="button" onClick={async () => onAnswer(await confirm(options))}>
        ask
      </button>
      {confirmDialog}
    </>
  );
}

const ask = async (options: ConfirmOptions = { title: { key: 'Удалить проповедь?' } }) => {
  const onAnswer = jest.fn();
  const view = render(<Asker options={options} onAnswer={onAnswer} />);
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'ask' }));
  });
  return { onAnswer, ...view };
};

describe('useConfirm', () => {
  afterEach(() => {
    mockLanguage = 'en';
  });

  it('shows nothing until it is asked', () => {
    render(<Asker options={{ title: { key: 'Удалить?' } }} onAnswer={jest.fn()} />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('asks in a window, with the words it was given', async () => {
    await ask({ title: { key: 'Удалить проповедь?' }, description: { said: 'Это нельзя отменить.' } });

    expect(screen.getByRole('dialog', { name: 'Удалить проповедь?' })).toBeInTheDocument();
    expect(screen.getByText('Это нельзя отменить.')).toBeInTheDocument();
  });

  it('says a question asked by key in the language switched to while it is open', async () => {
    const options: ConfirmOptions = {
      title: { key: 'sermon.deleteThoughtConfirm', values: { text: 'Мысль' } },
      description: { said: 'Мысль целиком' },
      confirmText: { key: 'common.delete' },
    };
    const onAnswer = jest.fn();
    const view = render(<Asker options={options} onAnswer={onAnswer} />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'ask' }));
    });
    expect(screen.getByRole('dialog', { name: 'sermon.deleteThoughtConfirm' })).toBeInTheDocument();

    mockLanguage = 'ru';
    view.rerender(<Asker options={options} onAnswer={onAnswer} />);

    const question = screen.getByRole('dialog', { name: 'ru:sermon.deleteThoughtConfirm text=Мысль' });
    expect(question).toHaveTextContent('Мысль целиком');
    expect(screen.getByRole('button', { name: 'ru:common.delete' })).toBeInTheDocument();
  });

  it('answers yes when the person confirms, and closes', async () => {
    const { onAnswer } = await ask();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    });

    expect(onAnswer).toHaveBeenCalledWith(true);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('answers no when the person cancels', async () => {
    const { onAnswer } = await ask();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    });

    expect(onAnswer).toHaveBeenCalledWith(false);
  });

  it('answers no on Escape', async () => {
    const { onAnswer } = await ask();

    await act(async () => {
      fireEvent.keyDown(window, { key: 'Escape' });
    });

    expect(onAnswer).toHaveBeenCalledWith(false);
  });

  it('answers no when the component leaves mid-question, instead of hanging', async () => {
    const { onAnswer, unmount } = await ask();

    await act(async () => {
      unmount();
    });

    expect(onAnswer).toHaveBeenCalledWith(false);
  });

  it('answers the first question no when a second one replaces it, then answers the second', async () => {
    const onAnswer = jest.fn();
    function TwoQuestions() {
      const { confirm, confirmDialog } = useConfirm();
      return (
        <>
          <button type="button" onClick={async () => onAnswer('first', await confirm({ title: { key: 'First?' } }))}>
            first
          </button>
          <button type="button" onClick={async () => onAnswer('second', await confirm({ title: { key: 'Second?' } }))}>
            second
          </button>
          {confirmDialog}
        </>
      );
    }
    render(<TwoQuestions />);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'first' }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'second' }));
    });

    expect(onAnswer).toHaveBeenCalledWith('first', false);
    expect(screen.getByRole('dialog', { name: 'Second?' })).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    });

    expect(onAnswer).toHaveBeenCalledWith('second', true);
    expect(onAnswer).toHaveBeenCalledTimes(2);
  });

  it('uses the caller\'s own button words when given', async () => {
    await ask({ title: { key: 'Убрать из серии?' }, confirmText: { key: 'Убрать' }, cancelText: { key: 'Оставить' } });

    expect(screen.getByRole('button', { name: 'Убрать' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Оставить' })).toBeInTheDocument();
  });

  it('never calls the browser\'s own confirm box', async () => {
    const native = jest.spyOn(window, 'confirm');
    await ask();
    expect(native).not.toHaveBeenCalled();
    native.mockRestore();
  });

  it('withdraws an open question on request: it answers "no" and the window goes away', async () => {
    function Withdrawer({ onAnswer }: { onAnswer: (answer: boolean) => void }) {
      const { confirm, confirmDialog, withdraw } = useConfirm();
      return (
        <>
          <button type="button" onClick={async () => onAnswer(await confirm({ title: { key: 'Удалить?' } }))}>ask</button>
          <button type="button" onClick={withdraw}>withdraw</button>
          {confirmDialog}
        </>
      );
    }
    const onAnswer = jest.fn();
    render(<Withdrawer onAnswer={onAnswer} />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'ask' }));
    });
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'withdraw' }));
    });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(onAnswer).toHaveBeenCalledWith(false);
  });
});

