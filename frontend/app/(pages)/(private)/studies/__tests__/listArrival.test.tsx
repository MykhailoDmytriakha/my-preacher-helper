import { act, render, waitFor } from '@testing-library/react';
import { useLayoutEffect } from 'react';

import { useListArrival } from '../StudyAnalysisWindow';

import type { StudyNote } from '@/models/models';

/*
 * Live probe, 04.11: from the reader's «Все разборы» the list never lit its card. On a move from another page the App
 * Router writes the new address after the first render; read then, the address was still the reader's, whose own `at=` is
 * a verse (`at=1:3`) — taken for an analysis that never came, and after the wait the list let go of the real one. The
 * list reads its way in once it stands at its own address.
 */
const note = (id: string) => ({ id, type: 'analysis' } as StudyNote);
function RouterWritesAddress({ to }: { to: string }) {
  useLayoutEffect(() => { window.history.pushState(null, '', to); }, [to]);
  return null;
}
function List({ notes }: { notes: StudyNote[] }) {
  const lit = useListArrival(notes);
  return (
    <>
      {notes.map((each) => (
        <article key={each.id} data-note-id={each.id} data-lit={lit === each.id ? 'true' : undefined}><div role="button" tabIndex={0} /></article>
      ))}
    </>
  );
}

describe('the list opened at an analysis by a move from the reader', () => {
  it('left by Back before the analysis came, never jumps to it when it comes', async () => {
    // Codex, 04.11 (round 4): the way in stayed after Back to an entry without it, and the late analysis scrolled the list.
    const scroll = jest.fn();
    const original = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = scroll;
    window.history.pushState(null, '', '/studies?tab=analyses');
    window.history.pushState(null, '', '/studies?tab=analyses&at=a2');
    try {
      const { rerender, container } = render(<List notes={[note('a1')]} />);
      act(() => window.history.back());
      await waitFor(() => expect(window.location.search).toBe('?tab=analyses'));
      rerender(<List notes={[note('a1'), note('a2')]} />);
      await act(() => new Promise((resolve) => setTimeout(resolve, 120)));
      expect(scroll).not.toHaveBeenCalled();
      expect(container.querySelector('[data-lit="true"]')).toBeNull();
    } finally {
      Element.prototype.scrollIntoView = original;
      window.history.replaceState(null, '', '/');
    }
  });

  it('reads its way in at its own address, not at the reader\'s it came from', () => {
    jest.useFakeTimers();
    const scroll = jest.fn();
    const original = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = scroll;
    window.history.replaceState(null, '', '/bible?book=ephesians&at=1:3&tr=rst&analysis=a2&mode=view');
    try {
      const { container } = render(<><RouterWritesAddress to="/studies?tab=analyses&at=a2" /><List notes={[note('a1'), note('a2')]} /></>);
      act(() => { jest.advanceTimersByTime(100); });
      expect(scroll).toHaveBeenCalledTimes(1);
      expect(container.querySelector('[data-lit="true"]')).toHaveAttribute('data-note-id', 'a2');
      expect(window.location.search).toBe('?tab=analyses');
    } finally {
      Element.prototype.scrollIntoView = original;
      jest.useRealTimers();
      window.history.replaceState(null, '', '/');
    }
  });
});
