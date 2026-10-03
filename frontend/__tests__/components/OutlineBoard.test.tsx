import { act, render, screen, fireEvent, within, cleanup, waitFor } from '@testing-library/react';
import React from 'react';

import '@testing-library/jest-dom';
import OutlineBoard from '@/components/plan-editor/OutlineBoard';
import { useModalLayer } from '@/hooks/useModalLayer';

import type { ScratchNote, SermonOutline } from '@/models/models';

const empty = (): SermonOutline => ({ introduction: [], main: [], conclusion: [] });

afterEach(cleanup);

describe('OutlineBoard', () => {
  it('renders three section columns', () => {
    render(<OutlineBoard value={empty()} onChange={jest.fn()} />);
    expect(screen.getByTestId('outline-board-column-introduction')).toBeInTheDocument();
    expect(screen.getByTestId('outline-board-column-main')).toBeInTheDocument();
    expect(screen.getByTestId('outline-board-column-conclusion')).toBeInTheDocument();
    expect(screen.queryByTestId('scratch-note-pool-band')).not.toBeInTheDocument();
  });

  it('adds a point to a section and emits the new outline (with a fresh id)', () => {
    const onChange = jest.fn();
    render(<OutlineBoard value={empty()} onChange={onChange} />);

    const introCol = screen.getByTestId('outline-board-column-introduction');
    fireEvent.click(within(introCol).getByText('structure.addPointButton'));
    const input = within(introCol).getByPlaceholderText('structure.addPointPlaceholder');
    fireEvent.change(input, { target: { value: 'context of the parable' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(onChange).toHaveBeenCalledTimes(1);
    const next = onChange.mock.calls[0][0] as SermonOutline;
    expect(next.introduction).toHaveLength(1);
    expect(next.introduction[0].text.toLowerCase()).toContain('context of the parable');
    expect(next.introduction[0].id).toBeTruthy();
    expect(next.main).toHaveLength(0);
    expect(next.conclusion).toHaveLength(0);
  });

  it('edits an existing point text', () => {
    const value: SermonOutline = {
      introduction: [{ id: 'p1', text: 'Old text' }],
      main: [],
      conclusion: [],
    };
    const onChange = jest.fn();
    render(<OutlineBoard value={value} onChange={onChange} />);

    const introCol = screen.getByTestId('outline-board-column-introduction');
    fireEvent.click(within(introCol).getByLabelText('common.edit'));
    const input = within(introCol).getByDisplayValue('Old text');
    fireEvent.change(input, { target: { value: 'New text' } });
    fireEvent.click(within(introCol).getByLabelText('common.save'));

    const next = onChange.mock.calls.at(-1)![0] as SermonOutline;
    expect(next.introduction[0].id).toBe('p1');
    expect(next.introduction[0].text.toLowerCase()).toContain('new text');
  });

  it('deletes a point after confirming in the overlay and reports it', () => {
    const value: SermonOutline = {
      introduction: [{ id: 'p1', text: 'To delete' }],
      main: [],
      conclusion: [],
    };
    const onChange = jest.fn();
    const onPointDeleted = jest.fn();
    render(<OutlineBoard value={value} onChange={onChange} onPointDeleted={onPointDeleted} />);

    const introCol = screen.getByTestId('outline-board-column-introduction');
    fireEvent.click(within(introCol).getByLabelText('common.delete')); // opens the confirm overlay
    // nothing removed until confirmed
    expect(onChange).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText('common.delete')); // the overlay's confirm button (text, not aria)
    const next = onChange.mock.calls.at(-1)![0] as SermonOutline;
    expect(next.introduction).toHaveLength(0);
    expect(onPointDeleted).toHaveBeenCalledWith('p1');
  });

  it('keeps the point when the delete overlay is cancelled', () => {
    const value: SermonOutline = {
      introduction: [{ id: 'p1', text: 'Keep me' }],
      main: [],
      conclusion: [],
    };
    const onChange = jest.fn();
    render(<OutlineBoard value={value} onChange={onChange} />);
    const introCol = screen.getByTestId('outline-board-column-introduction');
    fireEvent.click(within(introCol).getByLabelText('common.delete'));
    fireEvent.click(screen.getByText('common.cancel'));
    expect(onChange).not.toHaveBeenCalled();
  });

  it('warns that thoughts are unassigned (not deleted) when deleting a point that has thoughts', () => {
    const value: SermonOutline = {
      introduction: [{ id: 'p1', text: 'Has thoughts' }],
      main: [],
      conclusion: [],
    };
    render(<OutlineBoard value={value} onChange={jest.fn()} getPointThoughtCount={() => 3} />);
    const introCol = screen.getByTestId('outline-board-column-introduction');
    fireEvent.click(within(introCol).getByLabelText('common.delete'));
    expect(screen.getByText('planEditor.thoughtsUnassignedWarning')).toBeInTheDocument();
  });

  it('does not render add controls when read-only', () => {
    render(<OutlineBoard value={empty()} onChange={jest.fn()} isReadOnly />);
    expect(screen.queryByText('structure.addPointButton')).not.toBeInTheDocument();
  });

  it('appends a normalized sub-point after the highest existing position', () => {
    const existing = { id: 's1', text: 'Existing', position: 4000 };
    const value: SermonOutline = {
      introduction: [],
      main: [{ id: 'p1', text: 'Point', subPoints: [existing] }],
      conclusion: [],
    };
    const onChange = jest.fn();
    render(<OutlineBoard value={value} onChange={onChange} />);
    fireEvent.click(screen.getByText('structure.addSubPoint'));
    const input = screen.getByPlaceholderText('structure.subPointPlaceholder');
    fireEvent.change(input, { target: { value: '  new supporting idea  ' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0].main[0].subPoints).toEqual([
      existing,
      { id: expect.any(String), text: 'New supporting idea', position: 5000 },
    ]);
    expect(value.main[0].subPoints).toEqual([existing]);
    expect(screen.queryByPlaceholderText('structure.subPointPlaceholder')).not.toBeInTheDocument();
  });

  it('edits a sub-point while preserving its identity, position and siblings', () => {
    const first = { id: 's1', text: 'First', position: 1000, note: 'Keep this note' };
    const second = { id: 's2', text: 'Second', position: 2000 };
    const value: SermonOutline = {
      introduction: [],
      main: [{ id: 'p1', text: 'Point', subPoints: [first, second] }],
      conclusion: [],
    };
    const onChange = jest.fn();
    render(<OutlineBoard value={value} onChange={onChange} />);
    fireEvent.doubleClick(screen.getByText('First'));
    fireEvent.change(screen.getByDisplayValue('First'), { target: { value: '  revised first  ' } });
    fireEvent.click(screen.getByLabelText('common.save'));

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0].main[0].subPoints).toEqual([
      { ...first, text: 'Revised first' },
      second,
    ]);
    expect(value.main[0].subPoints).toEqual([first, second]);
  });

  it('confirms sub-point deletion before detaching its thoughts', () => {
    const value: SermonOutline = {
      introduction: [],
      main: [{ id: 'p1', text: 'Point', subPoints: [{ id: 's1', text: 'Child', position: 1000 }] }],
      conclusion: [],
    };
    const onChange = jest.fn();
    const onSubPointDeleted = jest.fn();
    render(
      <OutlineBoard value={value} onChange={onChange}
        onSubPointDeleted={onSubPointDeleted} getSubPointThoughtCount={() => 2} />
    );
    const childRow = screen.getByText('Child').parentElement!;
    fireEvent.click(within(childRow).getByLabelText('common.delete'));
    expect(onChange).not.toHaveBeenCalled();
    expect(onSubPointDeleted).not.toHaveBeenCalled();
    expect(screen.getByText('structure.subPointDeleteConfirm')).toBeInTheDocument();
    fireEvent.click(screen.getByText('common.delete'));
    expect(onChange.mock.calls[0][0].main[0].subPoints).toEqual([]);
    expect(onSubPointDeleted).toHaveBeenCalledWith('p1', 's1');
  });

  it('asks before deleting a sub-point that carries text even when no thoughts are attached', () => {
    const value: SermonOutline = {
      introduction: [],
      main: [{ id: 'p1', text: 'Point', subPoints: [{ id: 's1', text: 'My words here', position: 1000 }] }],
      conclusion: [],
    };
    const onChange = jest.fn();
    const onSubPointDeleted = jest.fn();
    render(
      <OutlineBoard value={value} onChange={onChange}
        onSubPointDeleted={onSubPointDeleted} getSubPointThoughtCount={() => 0} />
    );
    const childRow = screen.getByText('My words here').parentElement!;
    fireEvent.click(within(childRow).getByLabelText('common.delete'));
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByText('structure.subPointDeleteTextConfirm')).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('common.cancel'));
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByText('My words here')).toBeInTheDocument();

    fireEvent.click(within(screen.getByText('My words here').parentElement!).getByLabelText('common.delete'));
    fireEvent.click(screen.getByText('common.delete'));
    expect(onChange.mock.calls[0][0].main[0].subPoints).toEqual([]);
    expect(onSubPointDeleted).toHaveBeenCalledWith('p1', 's1');
  });

  it('never submits a surrounding form from its own buttons (the scratch board sits inside one)', () => {
    const value: SermonOutline = {
      introduction: [],
      main: [{ id: 'p1', text: 'Point', subPoints: [{ id: 's1', text: 'My words here', position: 1000 }] }],
      conclusion: [],
    };
    const onSubmit = jest.fn((event: React.FormEvent) => event.preventDefault());
    const { container } = render(
      <form onSubmit={onSubmit}>
        <OutlineBoard value={value} onChange={jest.fn()} getSubPointThoughtCount={() => 0} showNotes directText />
      </form>
    );
    container.querySelectorAll('button').forEach((button) => fireEvent.click(button));
    fireEvent.click(within(screen.getByText('My words here').closest('div')!.parentElement!).getAllByLabelText('common.delete')[0]);
    screen.queryAllByLabelText('common.cancel').forEach((button) => fireEvent.click(button));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(container.querySelectorAll('button:not([type="button"])')).toHaveLength(0);
  });

  it('removes an empty sub-point at once — there is nothing written to lose', () => {
    const value: SermonOutline = {
      introduction: [],
      main: [{ id: 'p1', text: 'Point', subPoints: [{ id: 's1', text: '', position: 1000 }] }],
      conclusion: [],
    };
    const onChange = jest.fn();
    render(<OutlineBoard value={value} onChange={onChange} getSubPointThoughtCount={() => 0} directText />);
    const mainCol = screen.getByTestId('outline-board-column-main');
    fireEvent.click(within(mainCol).getAllByLabelText('common.delete').at(-1)!);
    expect(onChange.mock.calls[0][0].main[0].subPoints).toEqual([]);
  });

  it('renders the optional scratch pool and point/sub-point strips only when scratch is provided', () => {
    const value: SermonOutline = {
      introduction: [],
      main: [
        {
          id: 'p1',
          text: 'Point',
          subPoints: [{ id: 's1', text: 'Sub', position: 1000 }],
        },
      ],
      conclusion: [],
    };

    const scratchNotes: ScratchNote[] = [
      { id: 'n1', text: 'Pool note', createdAt: '2026-07-05T00:00:00.000Z' },
      { id: 'n2', text: 'Point note', createdAt: '2026-07-05T00:01:00.000Z' },
      { id: 'n3', text: 'Sub note', createdAt: '2026-07-05T00:02:00.000Z' },
    ];
    const scratchProps = {
      notesById: new Map(scratchNotes.map((note) => [note.id, note])),
      onPlace: jest.fn(),
      renderNote: (note: ScratchNote) => <div>{note.text}</div>,
      poolHeader: <div>Scratch pool header</div>,
      poolEmptyLabel: 'Pool empty',
    };

    const { rerender } = render(
      <OutlineBoard
        value={value}
        onChange={jest.fn()}
        scratch={{
          ...scratchProps,
          pool: scratchNotes,
          placements: {},
        }}
      />
    );

    rerender(
      <OutlineBoard
        value={value}
        onChange={jest.fn()}
        scratch={{
          ...scratchProps,
          pool: [scratchNotes[0]],
          placements: {
            n2: { pointId: 'p1' },
            n3: { pointId: 'p1', subPointId: 's1' },
          },
        }}
      />
    );

    expect(screen.getByTestId('scratch-note-pool-band')).toHaveTextContent('Scratch pool header');
    expect(screen.getByTestId('scratch-note-pool-band')).toHaveTextContent('Pool note');
    expect(screen.getByTestId('scratch-note-pool-band')).not.toHaveTextContent('Point note');
    expect(screen.getByTestId('scratch-point-drop-zone-p1')).toHaveTextContent('Point note');
    expect(screen.getByTestId('scratch-subpoint-drop-zone-s1')).toHaveTextContent('Sub note');
    expect(screen.getByTestId('outline-board-column-main')).toHaveTextContent('structure.addSubPoint');
  });

  it('renders placed scratch notes from notesById on a fresh mount when the pool excludes them', () => {
    const value: SermonOutline = {
      introduction: [],
      main: [
        {
          id: 'p1',
          text: 'Point',
          subPoints: [{ id: 's1', text: 'Sub', position: 1000 }],
        },
      ],
      conclusion: [],
    };
    const scratchNotes: ScratchNote[] = [
      { id: 'n1', text: 'Pool note', createdAt: '2026-07-05T00:00:00.000Z' },
      { id: 'n2', text: 'Point note survives remount', createdAt: '2026-07-05T00:01:00.000Z' },
      { id: 'n3', text: 'Sub note survives remount', createdAt: '2026-07-05T00:02:00.000Z' },
    ];

    render(
      <OutlineBoard
        value={value}
        onChange={jest.fn()}
        scratch={{
          pool: [scratchNotes[0]],
          notesById: new Map(scratchNotes.map((note) => [note.id, note])),
          placements: {
            n2: { pointId: 'p1' },
            n3: { pointId: 'p1', subPointId: 's1' },
          },
          onPlace: jest.fn(),
          renderNote: (note: ScratchNote) => <div>{note.text}</div>,
          poolHeader: <div>Scratch pool header</div>,
          poolEmptyLabel: 'Pool empty',
        }}
      />
    );

    expect(screen.getByTestId('scratch-note-pool-band')).toHaveTextContent('Pool note');
    expect(screen.getByTestId('scratch-note-pool-band')).not.toHaveTextContent('Point note survives remount');
    expect(screen.getByTestId('scratch-point-drop-zone-p1')).toHaveTextContent('Point note survives remount');
    expect(screen.getByTestId('scratch-subpoint-drop-zone-s1')).toHaveTextContent('Sub note survives remount');
  });
});

describe('OutlineBoard — reminder notes', () => {
  it('shows an existing point note only when showNotes is enabled', () => {
    const value: SermonOutline = {
      introduction: [{ id: 'p1', text: 'Point', note: 'remember the story' }],
      main: [],
      conclusion: [],
    };
    const { rerender } = render(<OutlineBoard value={value} onChange={jest.fn()} />);
    // Off by default (e.g. template editor) → no note leaks into the UI.
    expect(screen.queryByText('remember the story')).not.toBeInTheDocument();
    expect(screen.queryByText('planEditor.note.add')).not.toBeInTheDocument();

    rerender(<OutlineBoard value={value} onChange={jest.fn()} showNotes />);
    expect(screen.getByText('remember the story')).toBeInTheDocument();
  });

  it('adds a note to a point and emits it (text preserved)', () => {
    const value: SermonOutline = {
      introduction: [{ id: 'p1', text: 'Point' }],
      main: [],
      conclusion: [],
    };
    const onChange = jest.fn();
    render(<OutlineBoard value={value} onChange={onChange} showNotes />);

    const introCol = screen.getByTestId('outline-board-column-introduction');
    fireEvent.click(within(introCol).getByLabelText('planEditor.note.label')); // "+ note"
    const textarea = within(introCol).getByPlaceholderText('planEditor.note.placeholder');
    fireEvent.change(textarea, { target: { value: 'start with a question' } });
    fireEvent.blur(textarea);

    const next = onChange.mock.calls.at(-1)![0] as SermonOutline;
    expect(next.introduction[0].note).toBe('start with a question');
    expect(next.introduction[0].text).toBe('Point');
    expect(next.introduction[0].id).toBe('p1');
  });

  it('saves a note with Enter', () => {
    const value: SermonOutline = { introduction: [{ id: 'p1', text: 'Point' }], main: [], conclusion: [] };
    const onChange = jest.fn();
    render(<OutlineBoard value={value} onChange={onChange} showNotes />);
    const introCol = screen.getByTestId('outline-board-column-introduction');
    fireEvent.click(within(introCol).getByLabelText('planEditor.note.label'));
    const textarea = within(introCol).getByPlaceholderText('planEditor.note.placeholder');
    fireEvent.change(textarea, { target: { value: 'via enter' } });
    fireEvent.keyDown(textarea, { key: 'Enter' });
    const next = onChange.mock.calls.at(-1)![0] as SermonOutline;
    expect(next.introduction[0].note).toBe('via enter');
  });

  it('deletes a note via the × affordance only after the question is confirmed', async () => {
    const value: SermonOutline = {
      introduction: [{ id: 'p1', text: 'Point', note: 'remove me' }],
      main: [],
      conclusion: [],
    };
    const onChange = jest.fn();
    render(<OutlineBoard value={value} onChange={onChange} showNotes />);
    const introCol = screen.getByTestId('outline-board-column-introduction');
    fireEvent.click(within(introCol).getByLabelText('planEditor.note.delete'));
    const question = await screen.findByRole('dialog', { name: 'planEditor.note.deleteConfirm' });
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.click(within(question).getByText('common.delete'));
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    const next = onChange.mock.calls.at(-1)![0] as SermonOutline;
    expect(next.introduction[0].note).toBeUndefined();
    expect(next.introduction[0].text).toBe('Point');
  });

  it('applies a confirmed note deletion to the outline as it is NOW, not as it was when asked', async () => {
    const asked: SermonOutline = {
      introduction: [{ id: 'p1', text: 'Point', note: 'remove me' }],
      main: [],
      conclusion: [],
    };
    const onChange = jest.fn();
    const { rerender } = render(<OutlineBoard value={asked} onChange={onChange} showNotes />);
    fireEvent.click(within(screen.getByTestId('outline-board-column-introduction')).getByLabelText('planEditor.note.delete'));
    const question = await screen.findByRole('dialog', { name: 'planEditor.note.deleteConfirm' });

    // While the question is open, a newer outline arrives (another edit, a save echo).
    const now: SermonOutline = { ...asked, main: [{ id: 'p2', text: 'Added meanwhile' }] };
    rerender(<OutlineBoard value={now} onChange={onChange} showNotes />);

    fireEvent.click(within(question).getByText('common.delete'));
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    const next = onChange.mock.calls.at(-1)![0] as SermonOutline;
    expect(next.introduction[0].note).toBeUndefined();
    expect(next.main).toEqual([{ id: 'p2', text: 'Added meanwhile' }]);
  });

  it('edits an existing sub-point note', () => {
    const value: SermonOutline = {
      introduction: [
        { id: 'p1', text: 'Point', subPoints: [{ id: 's1', text: 'Sub', position: 1000, note: 'old note' }] },
      ],
      main: [],
      conclusion: [],
    };
    const onChange = jest.fn();
    render(<OutlineBoard value={value} onChange={onChange} showNotes />);

    const introCol = screen.getByTestId('outline-board-column-introduction');
    expect(within(introCol).getByText('old note')).toBeInTheDocument();
    fireEvent.click(within(introCol).getByTitle('planEditor.note.label')); // the sub-point note line
    const textarea = within(introCol).getByDisplayValue('old note');
    fireEvent.change(textarea, { target: { value: 'new note' } });
    fireEvent.blur(textarea);

    const next = onChange.mock.calls.at(-1)![0] as SermonOutline;
    expect(next.introduction[0].subPoints![0].note).toBe('new note');
    expect(next.introduction[0].subPoints![0].text).toBe('Sub');
  });

  it('clears a note back to undefined when emptied', () => {
    const value: SermonOutline = {
      introduction: [{ id: 'p1', text: 'Point', note: 'temporary' }],
      main: [],
      conclusion: [],
    };
    const onChange = jest.fn();
    render(<OutlineBoard value={value} onChange={onChange} showNotes />);

    const introCol = screen.getByTestId('outline-board-column-introduction');
    fireEvent.click(within(introCol).getByTitle('planEditor.note.label'));
    const textarea = within(introCol).getByDisplayValue('temporary');
    fireEvent.change(textarea, { target: { value: '   ' } });
    fireEvent.blur(textarea);

    const next = onChange.mock.calls.at(-1)![0] as SermonOutline;
    expect(next.introduction[0].note).toBeUndefined();
  });

  it('Escape cancels note editing without emitting', () => {
    const value: SermonOutline = {
      introduction: [{ id: 'p1', text: 'Point' }],
      main: [],
      conclusion: [],
    };
    const onChange = jest.fn();
    render(<OutlineBoard value={value} onChange={onChange} showNotes />);

    const introCol = screen.getByTestId('outline-board-column-introduction');
    fireEvent.click(within(introCol).getByLabelText('planEditor.note.label'));
    const textarea = within(introCol).getByPlaceholderText('planEditor.note.placeholder');
    fireEvent.change(textarea, { target: { value: 'discard me' } });
    fireEvent.keyDown(textarea, { key: 'Escape' });

    expect(onChange).not.toHaveBeenCalled();
    expect(within(introCol).queryByDisplayValue('discard me')).not.toBeInTheDocument();
  });

  it('read-only shows an existing note but offers no add/edit affordance', () => {
    const value: SermonOutline = {
      introduction: [{ id: 'p1', text: 'Point', note: 'view only' }],
      main: [],
      conclusion: [],
    };
    render(<OutlineBoard value={value} onChange={jest.fn()} showNotes isReadOnly />);
    expect(screen.getByText('view only')).toBeInTheDocument();
    expect(screen.queryByText('planEditor.note.add')).not.toBeInTheDocument();
    expect(screen.queryByTitle('planEditor.note.label')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('planEditor.note.delete')).not.toBeInTheDocument();
  });
});

describe('Escape in a field of the board closes that field, not the window around the board', () => {
  function InWindow({ value, onClose }: { value: SermonOutline; onClose: () => void }) {
    const layer = useModalLayer({ onClose });
    return <div {...layer}><OutlineBoard value={value} onChange={jest.fn()} /></div>;
  }
  const withPoint: SermonOutline = { introduction: [{ id: 'p1', text: 'Old text', subPoints: [{ id: 's1', text: 'Sub text', position: 1000 }] }], main: [], conclusion: [] };
  const open: Record<string, () => HTMLElement> = {
    'adding a point': () => {
      fireEvent.click(within(screen.getByTestId('outline-board-column-introduction')).getByText('structure.addPointButton'));
      return screen.getByPlaceholderText('structure.addPointPlaceholder');
    },
    'editing a point': () => {
      fireEvent.click(within(screen.getByTestId('outline-board-column-introduction')).getAllByLabelText('common.edit')[0]);
      return screen.getByDisplayValue('Old text');
    },
    'adding a sub-point': () => {
      fireEvent.click(screen.getByText('structure.addSubPoint'));
      return screen.getByPlaceholderText('structure.subPointPlaceholder');
    },
    'editing a sub-point': () => {
      fireEvent.doubleClick(screen.getByText('Sub text'));
      return screen.getByDisplayValue('Sub text');
    },
  };
  it('cancelling a keyboard lift of a scratch note', async () => {
    const note: ScratchNote = { id: 'n1', text: 'Loose note', createdAt: '2026-07-05T00:00:00.000Z' };
    const onClose = jest.fn();
    function ScratchInWindow() {
      const layer = useModalLayer({ onClose });
      return <div {...layer}><OutlineBoard value={empty()} onChange={jest.fn()} scratch={{
        notesById: new Map([[note.id, note]]), onPlace: jest.fn(),
        renderNote: (n: ScratchNote, handleProps) => <div><span {...handleProps}>move</span>{n.text}</div>,
        poolHeader: <div>pool</div>, poolEmptyLabel: 'empty', pool: [note], placements: {},
      }} /></div>;
    }
    render(<ScratchInWindow />);
    const handle = document.querySelector<HTMLElement>('[aria-roledescription="draggable"]')!;
    handle.focus();

    fireEvent.keyDown(handle, { key: ' ', code: 'Space' });
    await waitFor(() => expect(handle).toHaveAttribute('aria-pressed', 'true'));
    fireEvent.keyDown(handle, { key: 'Escape', code: 'Escape' });

    await waitFor(() => expect(handle).not.toHaveAttribute('aria-pressed', 'true'));
    expect(onClose).not.toHaveBeenCalled();
  });

  it.each(Object.keys(open))('%s', (flow) => {
    const onClose = jest.fn();
    render(<InWindow value={flow === 'adding a point' ? empty() : withPoint} onClose={onClose} />);
    const field = open[flow]();

    fireEvent.keyDown(field, { key: 'Escape' });

    expect(field).not.toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe('a scratch note moved with the keyboard', () => {
  it('lands in the point the arrows brought it over when Space is pressed again', async () => {
    // Geometry is set by hand (jsdom lays nothing out); the sensor, the collision policy and the
    // drop handling are the real ones.
    const rect = (left: number, top = 0, width = 100, height = 60) =>
      ({ x: left, y: top, left, top, right: left + width, bottom: top + height, width, height, toJSON: () => ({}) });
    const boxes = jest.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      if (this.closest('[data-scratch-note="n"]')) return rect(0) as DOMRect;
      if (this.closest('[data-note-container="note-point:p"]')) return rect(200) as DOMRect;
      return rect(0, 0, 400, 200) as DOMRect;
    });
    const previous = Object.getOwnPropertyDescriptor(document, 'elementsFromPoint');
    Object.defineProperty(document, 'elementsFromPoint', {
      configurable: true,
      value: (x: number) => {
        const target = document.querySelector(`[data-note-container="${x >= 150 ? 'note-point:p' : 'note-pool'}"]`);
        return target ? [target] : [];
      },
    });
    try {
      const note: ScratchNote = { id: 'n', text: 'Loose note', createdAt: '2026-10-03' };
      const onMove = jest.fn();
      render(<OutlineBoard value={{ introduction: [{ id: 'p', text: 'Destination' }], main: [], conclusion: [] }} onChange={jest.fn()}
        scratch={{ pool: [note], notesById: new Map([['n', note]]), placements: {}, onPlace: jest.fn(), onMove,
          renderNote: (n: ScratchNote, handleProps) => <button {...handleProps}>{n.text}</button> }} />);
      const handle = screen.getByRole('button', { name: 'Loose note' });
      handle.focus();

      fireEvent.keyDown(handle, { key: ' ', code: 'Space' });
      await waitFor(() => expect(handle).toHaveAttribute('aria-pressed', 'true'));
      await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); });
      for (let i = 0; i < 6; i++) {
        fireEvent.keyDown(handle, { key: 'ArrowRight', code: 'ArrowRight' });
        await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
      }
      await waitFor(() => expect(document.querySelector('[data-note-container="note-point:p"] [data-scratch-slot="target"]')).not.toBeNull());
      fireEvent.keyDown(handle, { key: ' ', code: 'Space' });

      await waitFor(() => expect(onMove).toHaveBeenCalledTimes(1));
      expect(onMove).toHaveBeenCalledWith('n', { pointId: 'p' }, [], 0);
      expect(handle).not.toHaveAttribute('aria-pressed', 'true');
    } finally {
      boxes.mockRestore();
      if (previous) Object.defineProperty(document, 'elementsFromPoint', previous);
      else Reflect.deleteProperty(document, 'elementsFromPoint');
    }
  });
});
