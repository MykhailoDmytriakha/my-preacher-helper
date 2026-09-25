import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React, { useState } from 'react';

import type { ManualTextBinding } from '@/components/common/manualTextBinding';

export function manualTextFieldScenarios(field: 'title' | 'verse', renderField: (props: {
  value: string; onSave: (value: string) => Promise<void>; manual: ManualTextBinding;
}) => React.ReactNode) {
describe(`manual ${field} presentation`, () => {
  const inputLabel = field === 'title' ? 'Edit Title' : 'Scripture Verse';
  const failureLabel = field === 'title' ? 'Failed to save title' : 'Failed to save verse';
  function setup({ active = false, busy = false, value = 'Opened A', fail = '' } = {}) {
    const legacy = jest.fn(async () => undefined);
    const calls = { begin: jest.fn(), update: jest.fn(), save: jest.fn(), cancel: jest.fn() };
    function Harness({ remote = 'Opened A' }) {
      const [editing, setEditing] = useState(active);
      const [text, setText] = useState(value);
      const manual: ManualTextBinding = {
        active: editing, busy, value: text,
        begin: async () => { calls.begin(); if (fail === 'begin') throw new Error('storage'); setEditing(true); },
        update: async next => { calls.update(next); setText(next); if (fail === 'update') throw new Error('storage'); },
        save: async next => { calls.save(next); if (fail === 'save') throw new Error('storage'); setText(next); setEditing(false); },
        cancel: async () => { calls.cancel(); if (fail === 'cancel') throw new Error('storage'); setEditing(false); },
      };
      return renderField({ value: remote, onSave: legacy, manual });
    }
    const view = render(<Harness />);
    return { ...view, calls, legacy, changeRemote: (remote: string) => view.rerender(<Harness remote={remote} />) };
  }

  it('begins the engine form, persists each change and saves the selected value despite a remote prop change', async () => {
    const test = setup();
    fireEvent.click(screen.getByTitle('Edit'));
    await waitFor(() => expect(screen.getByLabelText(inputLabel)).toBeInTheDocument());
    expect(test.calls.begin).toHaveBeenCalledTimes(1);
    fireEvent.change(screen.getByLabelText(inputLabel), { target: { value: '  Draft B  ' } });
    expect(test.calls.update).toHaveBeenCalledWith('  Draft B  ');
    expect(test.calls.save).not.toHaveBeenCalled();
    test.changeRemote('Draft B');
    expect(screen.getByLabelText(inputLabel)).toHaveValue('  Draft B  ');
    fireEvent.click(screen.getByTitle('Save'));
    await waitFor(() => expect(test.calls.save).toHaveBeenCalledWith('Draft B'));
    expect(screen.queryByLabelText(inputLabel)).not.toBeInTheDocument();
    expect(test.legacy).not.toHaveBeenCalled();
  });

  it('renders a recovered manual stage without starting or saving it and cancels through its binding', async () => {
    const test = setup({ active: true, value: 'Recovered draft' });
    expect(screen.getByLabelText(inputLabel)).toHaveValue('Recovered draft');
    expect(test.calls.begin).not.toHaveBeenCalled(); expect(test.calls.save).not.toHaveBeenCalled();
    fireEvent.keyDown(screen.getByLabelText(inputLabel), { key: 'Escape' });
    await waitFor(() => expect(test.calls.cancel).toHaveBeenCalledTimes(1));
    expect(test.legacy).not.toHaveBeenCalled();
  });

  it('uses the existing keyboard save contract and treats an empty input as cancelling only this form', async () => {
    const test = setup({ active: true, value: '   ' });
    fireEvent.keyDown(screen.getByLabelText(inputLabel), { key: 'Enter', ctrlKey: field === 'verse' });
    await waitFor(() => expect(test.calls.cancel).toHaveBeenCalledTimes(1));
    expect(test.calls.save).not.toHaveBeenCalled(); expect(test.legacy).not.toHaveBeenCalled();
  });

  it.each(['begin', 'update', 'save', 'cancel'])('keeps a %s failure visible and never falls back to the legacy writer', async fail => {
    const silence = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const test = setup({ active: fail !== 'begin', fail });
      if (fail === 'begin') fireEvent.click(screen.getByTitle('Edit'));
      else if (fail === 'update') fireEvent.change(screen.getByLabelText(inputLabel), { target: { value: 'Still mine' } });
      else fireEvent.click(screen.getByTitle(fail === 'save' ? 'Save' : 'Cancel'));
      await waitFor(() => expect(screen.getByText(failureLabel)).toBeInTheDocument());
      expect(test.legacy).not.toHaveBeenCalled();
      if (fail !== 'begin') expect(screen.getByLabelText(inputLabel)).toBeInTheDocument();
    } finally { silence.mockRestore(); }
  });

  it('blocks new actions while local form persistence is busy', async () => {
    const test = setup({ active: true, busy: true });
    expect(screen.getByLabelText(inputLabel)).toBeDisabled();
    expect(screen.getByTitle('Save')).toBeDisabled();
    expect(screen.getByTitle('Cancel')).toBeDisabled();
    await act(async () => fireEvent.keyDown(screen.getByLabelText(inputLabel), { key: 'Enter', ctrlKey: true }));
    expect(test.calls.save).not.toHaveBeenCalled();
  });
});

}
