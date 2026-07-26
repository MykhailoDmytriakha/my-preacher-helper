import { render, screen, fireEvent } from '@testing-library/react';

import { SaveConflictBanner } from '@/components/SaveConflictBanner';
import '@testing-library/jest-dom';

/**
 * The shared conflict panel. Its whole job is to make "nothing was lost" TRUE
 * rather than merely stated, and to name the thing in front of the person — a
 * shared component with hardcoded wording once told sermon readers that their
 * "note" had changed.
 */
jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    // Echo the interpolation so a missing/incorrect entity is visible.
    t: (key: string, vars?: Record<string, string>) =>
      vars?.entity ? `${key}:${vars.entity}` : key,
  }),
}));

describe('SaveConflictBanner', () => {
  const actions = { onKeepMine: jest.fn(), onTakeTheirs: jest.fn() };

  beforeEach(() => {
    actions.onKeepMine.mockReset();
    actions.onTakeTheirs.mockReset();
  });

  it('shows the refused text, so "nothing is lost" is visible and not just claimed', () => {
    render(<SaveConflictBanner entityKey="entitySermon" pendingText="Typed on the laptop" {...actions} />);

    expect(screen.getByText('Typed on the laptop')).toBeInTheDocument();
  });

  it('names the entity it is talking about', () => {
    render(<SaveConflictBanner entityKey="entitySermon" {...actions} />);

    expect(
      screen.getByText('freshness.conflictDescription:freshness.entitySermon')
    ).toBeInTheDocument();
  });

  it('offers both choices and reports which one was taken', () => {
    render(<SaveConflictBanner entityKey="entityNote" {...actions} />);

    fireEvent.click(screen.getByText('freshness.conflictKeepMine'));
    expect(actions.onKeepMine).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByText('freshness.conflictTakeTheirs'));
    expect(actions.onTakeTheirs).toHaveBeenCalledTimes(1);
  });

  it('cannot be double-fired while a choice is being carried out', () => {
    render(<SaveConflictBanner entityKey="entityNote" busy {...actions} />);

    fireEvent.click(screen.getByText('freshness.conflictKeepMine'));
    fireEvent.click(screen.getByText('freshness.conflictTakeTheirs'));

    expect(actions.onKeepMine).not.toHaveBeenCalled();
    expect(actions.onTakeTheirs).not.toHaveBeenCalled();
  });

  it('announces itself, so a screen reader does not miss a refused save', () => {
    render(<SaveConflictBanner entityKey="entityNote" {...actions} />);

    expect(screen.getByRole('alert')).toBeInTheDocument();
  });
});
