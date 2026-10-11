import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

import '@testing-library/jest-dom';
import FeedbackForm from '@/components/navigation/FeedbackForm';

/**
 * GETTING THE TECHNICAL REPORT TO THE DEVELOPER WAS THE PERSON'S JOB.
 *
 * The form carried a button that promised something about the feedback and delivered a
 * viewer: a dialog full of JSON with a copy action. To actually send it you read the wall,
 * copied it, found the message box again and pasted it beside your own words. The owner did
 * exactly that, and what arrived was one field holding a paragraph of human sentences and
 * eight kilobytes of machine detail with the sentences buried in it.
 *
 * Now a checkbox sits with the other attachments and the app does the joining.
 */
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

jest.mock('@locales/i18n', () => ({}), { virtual: true });

jest.mock('@/utils/appDiagnostics', () => ({
  buildDiagnosticReport: jest.fn(() => ({ schema: 1, route: '/sermons/:id' })),
}));

const typeMessage = (text: string) => {
  fireEvent.change(screen.getByRole('textbox'), { target: { value: text } });
};

const submit = () => {
  fireEvent.click(screen.getByText('feedback.submitButton'));
};

type Sent = [string, string, string[], Record<string, unknown> | undefined];

/**
 * BESIDE THE WORDS, NOT INSIDE THEM (owner, 2026-10-10). The report used to be glued under the
 * person's message, so the letter was eight kilobytes of JSON with a sentence on top. Now the
 * words go as written and the report travels as its own piece — a field in the database and a
 * file attached to the letter.
 */
describe('the app attaches the technical report, the person does not', () => {
  it('sends the report beside the message, not inside it, when the box is ticked', async () => {
    const onSubmit = jest.fn(async () => true);
    render(<FeedbackForm onSubmit={onSubmit} onCancel={jest.fn()} />);

    typeMessage('the icon did not appear');
    submit();

    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    const [message, , , report] = onSubmit.mock.calls[0] as unknown as Sent;
    expect(message).toBe('the icon did not appear');
    expect(report).toEqual({ schema: 1, route: '/sermons/:id' });
  });

  it('is ticked to begin with, because whoever opens this form already hit something', () => {
    render(<FeedbackForm onSubmit={jest.fn()} onCancel={jest.fn()} />);

    expect(screen.getByTestId('attach-diagnostics')).toBeChecked();
  });

  it('sends the message alone once the box is cleared', async () => {
    const onSubmit = jest.fn(async () => true);
    render(<FeedbackForm onSubmit={onSubmit} onCancel={jest.fn()} />);

    fireEvent.click(screen.getByTestId('attach-diagnostics'));
    typeMessage('just an idea');
    submit();

    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    const [message, , , report] = onSubmit.mock.calls[0] as unknown as Sent;
    expect(message).toBe('just an idea');
    expect(report).toBeUndefined();
  });

  it('does not ask the network on the way out', async () => {
    /**
     * The viewer asks the server for its version, which is fine while someone reads a
     * dialog. On the send path that is a round trip between pressing the button and
     * anything happening — and offline it is a five-second timeout, at exactly the moment
     * people write about something being broken.
     */
    const fetchSpy = jest.spyOn(global, 'fetch' as never).mockImplementation(jest.fn() as never);
    const onSubmit = jest.fn(async () => true);
    render(<FeedbackForm onSubmit={onSubmit} onCancel={jest.fn()} />);

    typeMessage('quick note');
    submit();

    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it('does not send an empty message just because the report exists', async () => {
    const onSubmit = jest.fn(async () => true);
    render(<FeedbackForm onSubmit={onSubmit} onCancel={jest.fn()} />);

    submit();

    await waitFor(() => expect(onSubmit).not.toHaveBeenCalled());
  });
});

describe('an optional attachment never costs someone their message', () => {
  it('still sends the feedback when the report cannot be collected', async () => {
    /**
     * The report reads a dozen browser APIs, and any of them can be missing or refused —
     * a privacy mode, an unusual engine, an embedded webview. Letting that throw would
     * turn "I ticked a box" into "the send button does nothing", on the one form whose
     * purpose is telling us something is broken.
     */
    const { buildDiagnosticReport } = jest.requireMock('@/utils/appDiagnostics');
    (buildDiagnosticReport as jest.Mock).mockImplementationOnce(() => {
      throw new TypeError('window.matchMedia is not a function');
    });
    const onSubmit = jest.fn(async () => true);
    render(<FeedbackForm onSubmit={onSubmit} onCancel={jest.fn()} />);

    typeMessage('something is broken here');
    submit();

    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    const [message, , , report] = onSubmit.mock.calls[0] as unknown as Sent;
    expect(message).toBe('something is broken here');
    // And the report says so, rather than pretending the attachment was never asked for.
    expect(report).toEqual({ schema: 2, unavailable: true });
  });
});
