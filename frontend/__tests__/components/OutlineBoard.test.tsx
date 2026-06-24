import { render, screen, fireEvent, within, cleanup } from '@testing-library/react';
import React from 'react';

import '@testing-library/jest-dom';
import OutlineBoard from '@/components/plan-editor/OutlineBoard';

import type { SermonOutline } from '@/models/models';

const empty = (): SermonOutline => ({ introduction: [], main: [], conclusion: [] });

afterEach(cleanup);

describe('OutlineBoard', () => {
  it('renders three section columns', () => {
    render(<OutlineBoard value={empty()} onChange={jest.fn()} />);
    expect(screen.getByTestId('outline-board-column-introduction')).toBeInTheDocument();
    expect(screen.getByTestId('outline-board-column-main')).toBeInTheDocument();
    expect(screen.getByTestId('outline-board-column-conclusion')).toBeInTheDocument();
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
});
