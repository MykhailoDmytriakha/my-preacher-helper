import { render, screen, fireEvent, within, cleanup } from '@testing-library/react';
import React from 'react';

import '@testing-library/jest-dom';
import OutlineBoard from '@/components/plan-editor/OutlineBoard';

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

  it('deletes a note via the × affordance', () => {
    const value: SermonOutline = {
      introduction: [{ id: 'p1', text: 'Point', note: 'remove me' }],
      main: [],
      conclusion: [],
    };
    const onChange = jest.fn();
    render(<OutlineBoard value={value} onChange={onChange} showNotes />);
    const introCol = screen.getByTestId('outline-board-column-introduction');
    fireEvent.click(within(introCol).getByLabelText('planEditor.note.delete'));
    const next = onChange.mock.calls.at(-1)![0] as SermonOutline;
    expect(next.introduction[0].note).toBeUndefined();
    expect(next.introduction[0].text).toBe('Point');
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
