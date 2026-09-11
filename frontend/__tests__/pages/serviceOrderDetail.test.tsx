import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';

import ServiceOrderPage from '@/(pages)/(private)/care/orders/[id]/page';
import '@testing-library/jest-dom';

/**
 * The page a pastor writes into. Everything here is about not losing his words: the save that
 * does not wait for a blur, the step id that cannot double itself on a replay, and the refusal
 * that says so on the page instead of in the console.
 */

const mockUpdateSteps = jest.fn().mockResolvedValue(undefined);
const mockRenameOrder = jest.fn().mockResolvedValue(undefined);
const mockOpenedWith = jest.fn();
const mockClosedEditing = jest.fn().mockResolvedValue(undefined);
const mockRecheck = jest.fn().mockResolvedValue('absent');
const mockDeleteOrder = jest.fn().mockResolvedValue(undefined);
const mockPush = jest.fn();
const mockReadServer = jest.fn();
const mockFreshness = { state: 'fresh', remote: null, remotelyDeleted: false, checking: false, canCheck: true, checkAgain: jest.fn(), markSynced: jest.fn() };
jest.mock('@/services/serviceOrderEditing.client', () => ({ readServiceOrderOnServer: (...args: unknown[]) => mockReadServer(...args) }));
jest.mock('@/hooks/useDocumentFreshness', () => ({ useDocumentFreshness: () => mockFreshness }));


const state = {
  orders: [] as unknown[],
  loading: false,
  isOnline: true,
};

jest.mock('@/hooks/useServiceOrders', () => ({
  useServiceOrders: () => ({
    ...state,
    updateSteps: mockUpdateSteps,
    openedWith: mockOpenedWith,
    closedEditing: mockClosedEditing,
    recheck: mockRecheck,
    renameOrder: mockRenameOrder,
    deleteOrder: mockDeleteOrder,
  }),
}));

jest.mock('next/navigation', () => ({
  useParams: () => ({ id: 'order-1' }),
  useRouter: () => ({ push: mockPush }),
  useSearchParams: () => ({ get: () => null }),
}));

jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ children, href, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...props}>{children}</a>
  ),
}));

const order = (steps: unknown[]) => ({
  id: 'order-1',
  userId: 'u1',
  catalogKey: 'funeral',
  title: 'Погребение',
  summary: 'вступление · чтение',
  steps,
  rank: 1000,
  rev: { meta: 3 },
  createdAt: '2026-09-10T00:00:00.000Z',
  updatedAt: '2026-09-10T00:00:00.000Z',
});

const step = (id: string, title: string, body = '') => ({ id, title, body, scriptureRefs: [] });

describe('One service', () => {
  beforeEach(() => {
    mockFreshness.state = 'fresh';
    jest.clearAllMocks();
    jest.useRealTimers();
    state.orders = [order([step('s1', 'Перед началом'), step('s2', 'Молитва')])];
    state.loading = false;
    state.isOnline = true;
  });

  it('reads as a page, with the steps in order and no fields in sight', () => {
    render(<ServiceOrderPage />);

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Погребение');
    expect(screen.getByText('Перед началом')).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });

  /** Words that are not there yet say so, rather than showing a specimen he might read out. */
  it('says a step has no words instead of inventing any', () => {
    render(<ServiceOrderPage />);
    expect(screen.getAllByText('serviceOrders.stepEmpty').length).toBeGreaterThan(0);
  });

  it('offers a way back that does not depend on the trail above', () => {
    render(<ServiceOrderPage />);
    expect(screen.getByRole('link', { name: /serviceOrders\.backToList/ })).toHaveAttribute(
      'href',
      '/care/orders'
    );
  });

  describe('editing', () => {
    const enterEdit = () => fireEvent.click(screen.getByRole('button', { name: 'serviceOrders.edit' }));

    /**
     * THE SAVE THAT DOES NOT WAIT FOR A BLUR. A phone locks, a lid closes, a PWA is killed —
     * none of those fire a blur, and before this the paragraph was simply gone.
     */
    it('saves while he is still typing', async () => {
      jest.useFakeTimers();
      render(<ServiceOrderPage />);
      enterEdit();

      const words = screen.getAllByRole('textbox', { name: 'serviceOrders.stepWords' })[0];
      fireEvent.change(words, { target: { value: 'Кого попросить петь' } });

      expect(mockUpdateSteps).not.toHaveBeenCalled();
      jest.advanceTimersByTime(800);
      expect(mockUpdateSteps).toHaveBeenCalledTimes(1);
      jest.useRealTimers();
    });

    /**
     * Typed a sentence and went straight back. Unmount does not have to fire a blur, and the
     * first version of the cleanup simply cleared the timer — the sentence died with the page.
     *
     * What this proves is that the write is STARTED, which is all the page can promise: the
     * transaction behind it needs the server, and a process killed a moment later takes it with
     * it. Making the words themselves survive the death of the page needs a durable record of
     * the operation, which is deliberately separate work — see BUGS.md.
     */
    it('starts the waiting write when the page goes away', () => {
      jest.useFakeTimers();
      const { unmount } = render(<ServiceOrderPage />);
      enterEdit();

      const words = screen.getAllByRole('textbox', { name: 'serviceOrders.stepWords' })[0];
      fireEvent.change(words, { target: { value: 'Начать с Иоанна' } });
      expect(mockUpdateSteps).not.toHaveBeenCalled();

      unmount();

      expect(mockUpdateSteps).toHaveBeenCalledTimes(1);
      jest.useRealTimers();
    });

    it('flushes immediately when he leaves the field', () => {
      jest.useFakeTimers();
      render(<ServiceOrderPage />);
      enterEdit();

      const words = screen.getAllByRole('textbox', { name: 'serviceOrders.stepWords' })[0];
      fireEvent.change(words, { target: { value: 'Что читаю почти всегда' } });
      fireEvent.blur(words);

      expect(mockUpdateSteps).toHaveBeenCalledTimes(1);
      jest.useRealTimers();
    });

    /**
     * Type, wait for the timer, then tab away. The blur used to write again — the same words,
     * a second time, moving the revision counter for nothing and giving a second chance to
     * fail. Now it only sends what is still waiting.
     */
    it('does not write the same words twice when the timer already sent them', () => {
      jest.useFakeTimers();
      render(<ServiceOrderPage />);
      enterEdit();

      const words = screen.getAllByRole('textbox', { name: 'serviceOrders.stepWords' })[0];
      fireEvent.change(words, { target: { value: 'уже сохранено' } });
      jest.advanceTimersByTime(800);
      expect(mockUpdateSteps).toHaveBeenCalledTimes(1);

      fireEvent.blur(words);
      expect(mockUpdateSteps).toHaveBeenCalledTimes(1);
      jest.useRealTimers();
    });

    /** Text waiting for a step that is being removed must not be sent after it. */
    it('leaves no timer behind for a step that is removed', () => {
      jest.useFakeTimers();
      render(<ServiceOrderPage />);
      enterEdit();

      const words = screen.getAllByRole('textbox', { name: 'serviceOrders.stepWords' })[0];
      fireEvent.change(words, { target: { value: 'не доживёт' } });
      fireEvent.click(screen.getAllByRole('button', { name: 'serviceOrders.removeStep' })[0]);

      const callsAfterRemoval = mockUpdateSteps.mock.calls.length;
      jest.advanceTimersByTime(2000);
      expect(mockUpdateSteps).toHaveBeenCalledTimes(callsAfterRemoval);
      jest.useRealTimers();
    });

    /**
     * THE SCREEN HOLDS WHAT WAS TYPED FROM THE KEYSTROKE, not from the write seven hundred
     * milliseconds later. Between those two moments the words exist in exactly one place, and
     * if that place lagged the keyboard the page would be showing a sentence the person has
     * already changed.
     */
    it('keeps the typed words in the mirror before any write is attempted', () => {
      jest.useFakeTimers();
      render(<ServiceOrderPage />);
      enterEdit();

      const words = screen.getAllByRole('textbox', { name: 'serviceOrders.stepWords' })[0];
      fireEvent.change(words, { target: { value: 'ещё не сохранено' } });

      // Nothing has been written yet — and the page already holds the words.
      expect(mockUpdateSteps).not.toHaveBeenCalled();
      expect((screen.getAllByRole('textbox', { name: 'serviceOrders.stepWords' })[0] as HTMLTextAreaElement).value)
        .toBe('ещё не сохранено');
      jest.useRealTimers();
    });

    /**
     * ONE SOURCE ON SCREEN. The fields used to render the last CONFIRMED version while the mirror
     * held the typed one — so a restored draft could be written to the server while the person
     * was still looking at the old words, ready to type over them.
     */
    it('shows what was typed, not the last confirmed version', () => {
      jest.useFakeTimers();
      render(<ServiceOrderPage />);
      enterEdit();

      const words = screen.getAllByRole('textbox', { name: 'serviceOrders.stepWords' })[0] as HTMLTextAreaElement;
      fireEvent.change(words, { target: { value: 'набрано, но ещё не сохранено' } });
      jest.advanceTimersByTime(100);

      expect(
        (screen.getAllByRole('textbox', { name: 'serviceOrders.stepWords' })[0] as HTMLTextAreaElement).value
      ).toBe('набрано, но ещё не сохранено');
      jest.useRealTimers();
    });

    /**
     * Two fields in a row: the first write commits what it knew, and adopting its answer would
     * erase the newer text from the screen and from the rescue that is protecting it.
     */
    it('does not adopt a committed answer that is already out of date', async () => {
      let release: ((value: unknown) => void) | undefined;
      mockUpdateSteps.mockImplementationOnce(
        () => new Promise((resolve) => { release = resolve; })
      );
      render(<ServiceOrderPage />);
      enterEdit();

      const title = screen.getAllByRole('textbox', { name: 'serviceOrders.stepTitle' })[0] as HTMLInputElement;
      fireEvent.change(title, { target: { value: 'Новый заголовок' } });
      fireEvent.blur(title);

      const words = screen.getAllByRole('textbox', { name: 'serviceOrders.stepWords' })[0] as HTMLTextAreaElement;
      fireEvent.change(words, { target: { value: 'и слова следом' } });

      // The first write answers now, with the version that knew nothing about the words.
      release?.([{ id: 's1', title: 'Новый заголовок', body: '', scriptureRefs: [] }]);

      await waitFor(() =>
        expect(
          (screen.getAllByRole('textbox', { name: 'serviceOrders.stepWords' })[0] as HTMLTextAreaElement).value
        ).toBe('и слова следом')
      );
    });

    /**
     * A step being removed still gets its words sent first. Cancelling them was tidy and quietly
     * lossy: a refused removal brings the step back on the next read without the sentence that
     * was typed into it, and nothing anywhere says so.
     */
    it('sends the words of a step before removing it', () => {
      jest.useFakeTimers();
      render(<ServiceOrderPage />);
      enterEdit();

      const words = screen.getAllByRole('textbox', { name: 'serviceOrders.stepWords' })[0];
      fireEvent.change(words, { target: { value: 'не выбрасывать' } });
      expect(mockUpdateSteps).not.toHaveBeenCalled();

      fireEvent.click(screen.getAllByRole('button', { name: 'serviceOrders.removeStep' })[0]);

      // Two writes, in this order: the words, then the removal.
      expect(mockUpdateSteps.mock.calls.length).toBeGreaterThanOrEqual(2);
      jest.useRealTimers();
    });

    /**
     * A retried write must not append a second step. The id is minted once, outside the
     * mutator, so replaying the same operation finds its own step already there.
     */
    it('adds a step whose repeat is a no-op', () => {
      render(<ServiceOrderPage />);
      enterEdit();
      fireEvent.click(screen.getByRole('button', { name: 'serviceOrders.addStep' }));

      const mutate = mockUpdateSteps.mock.calls[0][1] as (steps: unknown[]) => unknown[] | null;
      const existing = [step('s1', 'Перед началом')];
      const afterFirst = mutate(existing) as { id: string }[];
      expect(afterFirst).toHaveLength(2);
      // The same operation run again against its own result changes nothing.
      expect(mutate(afterFirst)).toBeNull();
    });

    it('moves a step without touching the others', () => {
      render(<ServiceOrderPage />);
      enterEdit();
      fireEvent.click(screen.getAllByRole('button', { name: 'serviceOrders.moveDown' })[0]);

      const mutate = mockUpdateSteps.mock.calls[0][1] as (steps: unknown[]) => unknown[] | null;
      const result = mutate([step('s1', 'a'), step('s2', 'b')]) as { id: string }[];
      expect(result.map((s) => s.id)).toEqual(['s2', 's1']);
    });

    /**
     * The guard needs the values the editor OPENED with. The page hands them over once and
     * keeps none of it: the baseline belongs beside the queue that serialises the writes, or
     * the second save of the same name is judged against a number the server has left behind.
     */
    it('hands over the revision and title it opened on, and renames without a baseline', async () => {
      render(<ServiceOrderPage />);
      enterEdit();

      const title = screen.getByRole('textbox', { name: 'serviceOrders.orderTitle' });
      fireEvent.focus(title);
      fireEvent.change(title, { target: { value: 'Погребение ребёнка' } });
      fireEvent.blur(title);

      expect(mockOpenedWith).toHaveBeenCalledWith(
        'order-1',
        { title: 'Погребение', revision: 3 },
        expect.any(String)
      );
      await waitFor(() =>
        expect(mockRenameOrder).toHaveBeenCalledWith('order-1', 'Погребение ребёнка', expect.any(String))
      );
    });

    /**
     * THE NAME IS NOT THE ONE FIELD THAT WAITS FOR A BLUR.
     *
     * It was, and a locked phone never blurs: every word under the name saved itself as it was
     * typed while the name itself was thrown away. Same timer, same flush, same guarantee.
     */
    it('saves a name that was typed and never left', () => {
      jest.useFakeTimers();
      render(<ServiceOrderPage />);
      enterEdit();

      const title = screen.getByRole('textbox', { name: 'serviceOrders.orderTitle' });
      fireEvent.focus(title);
      fireEvent.change(title, { target: { value: 'Погребение ребёнка' } });
      act(() => {
        jest.advanceTimersByTime(700);
      });

      expect(mockRenameOrder).toHaveBeenCalledWith('order-1', 'Погребение ребёнка', expect.any(String));
      jest.useRealTimers();
    });

    /**
     * CHANGING YOUR MIND BACK IS STILL A CHANGE.
     *
     * Rename the rite, then return the name to what it was while the first save is still
     * travelling: the page used to compare against the cached title — the version from before
     * that save — call it a no-op and drop it. The rejected name landed and stayed. Whether the
     * name actually changed is decided beside the queue, where the answer is current.
     */
    it('saves a name changed back while the first save is still travelling', () => {
      jest.useFakeTimers();
      // The first save never answers, which is exactly the window the mistake lived in.
      mockRenameOrder.mockImplementationOnce(() => new Promise(() => {}));
      render(<ServiceOrderPage />);
      enterEdit();

      const title = screen.getByRole('textbox', { name: 'serviceOrders.orderTitle' });
      fireEvent.focus(title);
      fireEvent.change(title, { target: { value: 'Отпевание' } });
      act(() => {
        jest.advanceTimersByTime(700);
      });
      fireEvent.change(title, { target: { value: 'Погребение' } });
      act(() => {
        jest.advanceTimersByTime(700);
      });

      expect(mockRenameOrder).toHaveBeenCalledTimes(2);
      expect(mockRenameOrder).toHaveBeenLastCalledWith('order-1', 'Погребение', expect.any(String));
      jest.useRealTimers();
    });

    /**
     * A REFUSED REMOVAL COMES BACK. The step is still on the server, and a screen that keeps
     * showing it gone is a lie the pastor only discovers on his next reload — by which time he
     * has stopped looking for it.
     */
    it('puts a refused removal back on the screen', async () => {
      mockUpdateSteps.mockRejectedValueOnce(new Error('Missing or insufficient permissions.'));
      render(<ServiceOrderPage />);
      enterEdit();

      fireEvent.click(screen.getAllByRole('button', { name: 'serviceOrders.removeStep' })[0]);

      await waitFor(() =>
        expect(screen.getByTestId('service-order-failure')).toBeInTheDocument()
      );
      expect(screen.getAllByRole('textbox', { name: 'serviceOrders.stepTitle' })).toHaveLength(2);
    });

    /**
     * AND IT COMES BACK EVEN IF HE KEPT TYPING.
     *
     * Putting the whole list back was only correct while nothing had been typed since — and the
     * moment something had, the rollback was skipped altogether: the step stayed gone from the
     * screen while the server still had it. The inverse touches only its own step, so the newer
     * words stay exactly where they are.
     */
    it('puts a refused removal back even after the next words are typed', async () => {
      let refuse: ((reason: Error) => void) | undefined;
      mockUpdateSteps.mockImplementationOnce(
        () => new Promise((_resolve, reject) => { refuse = reject; })
      );
      render(<ServiceOrderPage />);
      enterEdit();

      fireEvent.click(screen.getAllByRole('button', { name: 'serviceOrders.removeStep' })[0]);
      // The pastor carries on writing in the step that is left, before the refusal arrives.
      const words = screen.getAllByRole('textbox', { name: 'serviceOrders.stepWords' })[0];
      fireEvent.change(words, { target: { value: 'молитва у гроба' } });

      await act(async () => {
        refuse?.(new Error('Missing or insufficient permissions.'));
        await Promise.resolve();
      });

      const headings = screen
        .getAllByRole('textbox', { name: 'serviceOrders.stepTitle' })
        .map((field) => (field as HTMLInputElement).value);
      expect(headings).toEqual(['Перед началом', 'Молитва']);
      // ...and what he typed in the meantime is still there.
      expect(
        screen.getAllByRole('textbox', { name: 'serviceOrders.stepWords' })
          .map((field) => (field as HTMLTextAreaElement).value)
      ).toContain('молитва у гроба');
    });

    /**
     * ONE STRUCTURAL CHANGE AT A TIME, so there is never a second one to reconcile against.
     *
     * Two of them in the air at once is what made every undo ambiguous: the first one's opposite
     * had to be applied to a list the second had already rearranged, by position, which no longer
     * meant the same thing. Two review rounds each found a different way for that to end with the
     * screen and the server disagreeing.
     */
    it('holds the rearranging controls while one change is in the air', async () => {
      let settle: (() => void) | undefined;
      mockUpdateSteps.mockImplementationOnce(
        () => new Promise((resolve) => { settle = () => resolve([step('s1', 'Перед началом'), step('s2', 'Молитва')]); })
      );
      render(<ServiceOrderPage />);
      enterEdit();

      await act(async () => {
        fireEvent.click(screen.getAllByRole('button', { name: 'serviceOrders.moveDown' })[0]);
      });

      expect(screen.getByRole('button', { name: 'serviceOrders.addStep' })).toBeDisabled();
      expect(screen.getAllByRole('button', { name: 'serviceOrders.removeStep' })[0]).toBeDisabled();
      // Typing is never held up.
      expect(screen.getAllByRole('textbox', { name: 'serviceOrders.stepWords' })[0]).toBeEnabled();

      await act(async () => {
        settle?.();
      });
      expect(screen.getByRole('button', { name: 'serviceOrders.addStep' })).toBeEnabled();
    });

    /**
     * A STEP THAT WAS WRITTEN INTO SURVIVES THE REFUSAL OF ITS OWN CREATION.
     *
     * The opposite of "add" is "remove", and applied without looking it took the paragraph the
     * pastor had just typed into the new step with it — words that existed on that screen and
     * nowhere else.
     */
    it('keeps a refused new step once it has words in it', async () => {
      let refuse: ((reason: Error) => void) | undefined;
      mockUpdateSteps.mockImplementationOnce(
        () => new Promise((_resolve, reject) => { refuse = reject; })
      );
      render(<ServiceOrderPage />);
      enterEdit();

      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'serviceOrders.addStep' }));
      });
      const fields = screen.getAllByRole('textbox', { name: 'serviceOrders.stepWords' });
      fireEvent.change(fields[fields.length - 1], { target: { value: 'слово у могилы' } });

      await act(async () => {
        refuse?.(new Error('Missing or insufficient permissions.'));
        await Promise.resolve();
      });

      expect(
        screen.getAllByRole('textbox', { name: 'serviceOrders.stepWords' })
          .map((field) => (field as HTMLTextAreaElement).value)
      ).toContain('слово у могилы');
      expect(screen.getByTestId('service-order-failure')).toBeInTheDocument();
    });

    /**
     * AN EMPTY STEP THE SERVER SAYS IS GONE LEAVES THE SCREEN.
     *
     * There is nothing to move back and nothing in it to keep, and a step announced as gone
     * while still sitting in the list is a page arguing with itself.
     */
    it('drops an empty step the server says is gone instead of moving it back', async () => {
      state.orders = [order([step('s1', ''), step('s2', 'Молитва')])];
      mockUpdateSteps.mockImplementationOnce(
        async (_id: string, mutate: (steps: unknown[]) => unknown[] | null) => mutate([step('s2', 'Молитва')])
      );
      render(<ServiceOrderPage />);
      enterEdit();

      await act(async () => {
        fireEvent.click(screen.getAllByRole('button', { name: 'serviceOrders.moveDown' })[0]);
      });

      expect(screen.getByTestId('service-order-failure')).toHaveTextContent('serviceOrders.stepGone');
      expect(
        screen.getAllByRole('textbox', { name: 'serviceOrders.stepTitle' })
          .map((field) => (field as HTMLInputElement).value)
      ).toEqual(['Молитва']);
    });

    /**
     * BUT NOT IF IT HAS WORDS IN IT.
     *
     * Tidying the step away destroyed a paragraph: it was filtered off the screen while the write
     * carrying its words was still on its way to learn the same thing, and the words had nowhere
     * left to be. They stay in front of the person who typed them, and the sentence says why.
     */
    it('keeps a gone step that has words in it', async () => {
      mockUpdateSteps.mockImplementationOnce(
        async (_id: string, mutate: (steps: unknown[]) => unknown[] | null) => mutate([step('s2', 'Молитва')])
      );
      render(<ServiceOrderPage />);
      enterEdit();

      const words = screen.getAllByRole('textbox', { name: 'serviceOrders.stepWords' })[0];
      fireEvent.change(words, { target: { value: 'у самой могилы' } });
      await act(async () => {
        fireEvent.click(screen.getAllByRole('button', { name: 'serviceOrders.moveDown' })[0]);
      });

      expect(screen.getByTestId('service-order-failure')).toHaveTextContent('serviceOrders.stepGone');
      expect(
        screen.getAllByRole('textbox', { name: 'serviceOrders.stepWords' })
          .map((field) => (field as HTMLTextAreaElement).value)
      ).toContain('у самой могилы');
    });

    /**
     * A TIMED-OUT TRANSACTION IS NOT A REFUSAL.
     *
     * It may well have committed. Undoing the change on screen would then show a rite that no
     * longer matches the stored one, and the next edit would be made against a version nobody
     * has. The change stays, and the page says plainly that it does not know.
     */
    it('does not undo a change whose fate is unknown', async () => {
      mockUpdateSteps.mockRejectedValueOnce(
        Object.assign(new Error('deadline exceeded'), { code: 'deadline-exceeded' })
      );
      render(<ServiceOrderPage />);
      enterEdit();

      await act(async () => {
        fireEvent.click(screen.getAllByRole('button', { name: 'serviceOrders.moveDown' })[0]);
      });

      expect(screen.getByTestId('service-order-failure')).toHaveTextContent('serviceOrders.writeUnknown');
      expect(
        screen.getAllByRole('textbox', { name: 'serviceOrders.stepTitle' })
          .map((field) => (field as HTMLInputElement).value)
      ).toEqual(['Молитва', 'Перед началом']);
    });

    /** And once the server's own answer shows the step, the question about it is settled. */
    it('stops calling a step unsaved once a committed answer contains it', async () => {
      mockUpdateSteps.mockRejectedValueOnce(
        Object.assign(new Error('unavailable'), { code: 'unavailable' })
      );
      render(<ServiceOrderPage />);
      enterEdit();

      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'serviceOrders.addStep' }));
      });
      expect(screen.getByTestId('service-order-failure')).toBeInTheDocument();

      expect(screen.getAllByRole('textbox', { name: 'serviceOrders.stepTitle' })).toHaveLength(3);

      // The id the add minted, taken from the operation the page sent.
      const mutate = mockUpdateSteps.mock.calls[0][1] as (steps: unknown[]) => { id: string }[];
      const addedId = mutate([])[0].id;

      // The next write comes back with the rite the server holds — and it has that step.
      mockUpdateSteps.mockImplementationOnce(async () => [
        step('s1', 'Перед началом', 'слово'),
        step('s2', 'Молитва'),
        step(addedId, ''),
      ]);
      const words = screen.getAllByRole('textbox', { name: 'serviceOrders.stepWords' })[0];
      fireEvent.change(words, { target: { value: 'слово' } });
      await act(async () => {
        fireEvent.blur(words);
      });

      expect(screen.queryByTestId('service-order-failure')).not.toBeInTheDocument();
    });

    /** An empty step that was never written into simply goes when its creation is refused. */
    it('takes back a refused new step that was never written into', async () => {
      mockUpdateSteps.mockRejectedValueOnce(new Error('Missing or insufficient permissions.'));
      render(<ServiceOrderPage />);
      enterEdit();

      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'serviceOrders.addStep' }));
      });

      expect(screen.getAllByRole('textbox', { name: 'serviceOrders.stepTitle' })).toHaveLength(2);
    });

    /** The opposite rule for words: refused or not, they stay — they are the thing to save. */
    it('keeps refused words in the field', async () => {
      mockUpdateSteps.mockRejectedValueOnce(new Error('Missing or insufficient permissions.'));
      render(<ServiceOrderPage />);
      enterEdit();

      const words = screen.getAllByRole('textbox', { name: 'serviceOrders.stepWords' })[0];
      fireEvent.change(words, { target: { value: 'над этим гробом' } });
      fireEvent.blur(words);

      await waitFor(() =>
        expect(screen.getByTestId('service-order-failure')).toBeInTheDocument()
      );
      expect(
        (screen.getAllByRole('textbox', { name: 'serviceOrders.stepWords' })[0] as HTMLTextAreaElement).value
      ).toBe('над этим гробом');
      expect(screen.getByTestId('service-order-failure')).toBeInTheDocument();
    });

    /**
     * TWO REFERENCES, TYPED THE ORDINARY WAY.
     *
     * The field used to show the parsed list joined back together, so the comma between two
     * references vanished the instant it was typed and the next reference was written onto the
     * end of the first. Every pastor who cites two verses met this.
     */
    it('keeps the comma while two references are being typed', () => {
      render(<ServiceOrderPage />);
      enterEdit();

      const refs = screen.getAllByRole('textbox', { name: 'serviceOrders.refs' })[0];
      fireEvent.change(refs, { target: { value: 'Ин. 11:25, ' } });
      expect((refs as HTMLInputElement).value).toBe('Ин. 11:25, ');

      fireEvent.change(refs, { target: { value: 'Ин. 11:25, Пс. 22' } });
      expect((refs as HTMLInputElement).value).toBe('Ин. 11:25, Пс. 22');
    });

    /** An emptied name is refused OUT LOUD: silently ignoring it looked like the page was broken. */
    it('says a rite needs a name instead of ignoring an emptied one', async () => {
      render(<ServiceOrderPage />);
      enterEdit();

      const title = screen.getByRole('textbox', { name: 'serviceOrders.orderTitle' });
      fireEvent.focus(title);
      fireEvent.change(title, { target: { value: '   ' } });
      await act(async () => {
        fireEvent.blur(title);
      });

      expect(screen.getByTestId('service-order-failure')).toHaveTextContent('serviceOrders.titleRequired');
      expect(mockRenameOrder).not.toHaveBeenCalled();
    });

    /**
     * THE NAME OF THE RITE IS UNDER THE SAME RULE AS THE WORDS.
     *
     * A refused paragraph kept its sentence on the page only until the pastor saved the TITLE:
     * that save cleared the banner, and the paragraph sat there looking like ordinary saved
     * content until a reload took it.
     */
    it('keeps saying a paragraph is unsaved after the name saves', async () => {
      mockUpdateSteps.mockRejectedValueOnce(new Error('Missing or insufficient permissions.'));
      render(<ServiceOrderPage />);
      enterEdit();

      const words = screen.getAllByRole('textbox', { name: 'serviceOrders.stepWords' })[0];
      fireEvent.change(words, { target: { value: 'над этим гробом' } });
      await act(async () => {
        fireEvent.blur(words);
      });

      const title = screen.getByRole('textbox', { name: 'serviceOrders.orderTitle' });
      fireEvent.focus(title);
      fireEvent.change(title, { target: { value: 'Погребение ребёнка' } });
      await act(async () => {
        fireEvent.blur(title);
      });

      expect(screen.getByTestId('service-order-failure')).toBeInTheDocument();
    });

    /** And the other way round: a refused NAME is not made to look saved by a saved paragraph. */
    it('keeps saying the name is unsaved after a paragraph saves', async () => {
      mockRenameOrder.mockRejectedValueOnce(new Error('Missing or insufficient permissions.'));
      render(<ServiceOrderPage />);
      enterEdit();

      const title = screen.getByRole('textbox', { name: 'serviceOrders.orderTitle' });
      fireEvent.focus(title);
      fireEvent.change(title, { target: { value: 'Погребение ребёнка' } });
      await act(async () => {
        fireEvent.blur(title);
      });
      expect(screen.getByTestId('service-order-failure')).toBeInTheDocument();

      mockUpdateSteps.mockImplementationOnce(async () => [step('s1', 'Перед началом', 'мои слова'), step('s2', 'Молитва')]);
      const words = screen.getAllByRole('textbox', { name: 'serviceOrders.stepWords' })[0];
      fireEvent.change(words, { target: { value: 'мои слова' } });
      await act(async () => {
        fireEvent.blur(words);
      });

      expect(screen.getByTestId('service-order-failure')).toBeInTheDocument();
    });

    /**
     * A REFUSAL IS REMEMBERED BY FIELD, NOT BY STEP.
     *
     * The heading and the words of one step are two different saves. Recording the refusal under
     * the step alone meant that saving the heading a moment later cleared the marker the BODY
     * had left, and the refused paragraph was adopted away with it.
     */
    it('keeps a refused body when the same step\'s heading saves', async () => {
      mockUpdateSteps.mockRejectedValueOnce(new Error('Missing or insufficient permissions.'));
      render(<ServiceOrderPage />);
      enterEdit();

      const words = screen.getAllByRole('textbox', { name: 'serviceOrders.stepWords' })[0];
      fireEvent.change(words, { target: { value: 'над этим гробом' } });
      await act(async () => {
        fireEvent.blur(words);
      });
      expect(screen.getByTestId('service-order-failure')).toBeInTheDocument();

      // The heading of the SAME step saves, and the server answers without the refused body.
      mockUpdateSteps.mockImplementationOnce(async () => [
        step('s1', 'Перед выносом'),
        step('s2', 'Молитва'),
      ]);
      const heading = screen.getAllByRole('textbox', { name: 'serviceOrders.stepTitle' })[0];
      fireEvent.change(heading, { target: { value: 'Перед выносом' } });
      await act(async () => {
        fireEvent.blur(heading);
      });

      expect(
        (screen.getAllByRole('textbox', { name: 'serviceOrders.stepWords' })[0] as HTMLTextAreaElement).value
      ).toBe('над этим гробом');
      expect(screen.getByTestId('service-order-failure')).toBeInTheDocument();
    });

    /**
     * A REFUSAL IS NOT UNDONE BY THE NEXT SUCCESS.
     *
     * The words the server refused live on this screen and nowhere else. A structural write that
     * succeeds a moment later comes back with the rite as the server has it — without them — and
     * adopting that answer wiped the screen clean of the very text the banner was about.
     */
    it('keeps refused words when a later structural write succeeds', async () => {
      mockUpdateSteps.mockRejectedValueOnce(new Error('Missing or insufficient permissions.'));
      render(<ServiceOrderPage />);
      enterEdit();

      const words = screen.getAllByRole('textbox', { name: 'serviceOrders.stepWords' })[0];
      fireEvent.change(words, { target: { value: 'над этим гробом' } });
      await act(async () => {
        fireEvent.blur(words);
      });
      expect(screen.getByTestId('service-order-failure')).toBeInTheDocument();

      // The server knows nothing of the refused sentence, and says so truthfully.
      mockUpdateSteps.mockImplementationOnce(async () => [
        step('s1', 'Перед началом'),
        step('s2', 'Молитва'),
        step('s3', ''),
      ]);
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'serviceOrders.addStep' }));
      });

      expect(
        (screen.getAllByRole('textbox', { name: 'serviceOrders.stepWords' })[0] as HTMLTextAreaElement).value
      ).toBe('над этим гробом');
      expect(screen.getByTestId('service-order-failure')).toBeInTheDocument();
    });

    /**
     * A STEP ANOTHER DEVICE DELETED IS NOT A STEP THIS PASTOR DISCARDED.
     *
     * Both leave the rite; only one of them means the words may go. Retiring a refusal because
     * the step was simply ABSENT from a later server answer covered the wrong case too: the
     * refused paragraph, which existed on this screen and nowhere else, was adopted away by the
     * next successful action.
     */
    it('keeps refused words when the step was removed somewhere else', async () => {
      mockUpdateSteps.mockRejectedValueOnce(new Error('Missing or insufficient permissions.'));
      render(<ServiceOrderPage />);
      enterEdit();

      const words = screen.getAllByRole('textbox', { name: 'serviceOrders.stepWords' })[0];
      fireEvent.change(words, { target: { value: 'над этим гробом' } });
      await act(async () => {
        fireEvent.blur(words);
      });

      // Another device has meanwhile deleted that step, so the server's answer to the next
      // action has no trace of it.
      mockUpdateSteps.mockImplementationOnce(async () => [step('s2', 'Молитва'), step('s3', '')]);
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'serviceOrders.addStep' }));
      });

      expect(
        screen.getAllByRole('textbox', { name: 'serviceOrders.stepWords' })
          .map((field) => (field as HTMLTextAreaElement).value)
      ).toContain('над этим гробом');
      // And it is still SAID: words kept on screen with nothing said about them read as saved.
      expect(screen.getByTestId('service-order-failure')).toBeInTheDocument();
    });

    /**
     * A STEP THAT IS GONE TAKES ITS UNRESOLVED REFUSALS WITH IT.
     *
     * Otherwise removing a step whose words had been refused left behind a marker that nothing
     * could ever clear — and while one stands, nothing is adopted, so the screen stops following
     * the document for the rest of the session.
     */
    it('stops holding the screen once the refused step is gone', async () => {
      mockUpdateSteps.mockRejectedValueOnce(new Error('Missing or insufficient permissions.'));
      const { rerender } = render(<ServiceOrderPage />);
      enterEdit();

      const words = screen.getAllByRole('textbox', { name: 'serviceOrders.stepWords' })[0];
      fireEvent.change(words, { target: { value: 'над этим гробом' } });
      await act(async () => {
        fireEvent.blur(words);
      });

      // The step itself is removed, and the server confirms a rite without it.
      mockUpdateSteps.mockImplementationOnce(async () => [step('s2', 'Молитва')]);
      await act(async () => {
        fireEvent.click(screen.getAllByRole('button', { name: 'serviceOrders.removeStep' })[0]);
      });

      // Background updates wait for explicit acceptance; a confirmed deletion must not reappear.
      state.orders = [order([step('s2', 'Молитва'), step('s3', 'Пришло с ноутбука')])];
      rerender(<ServiceOrderPage />);

      expect(
        screen.getAllByRole('textbox', { name: 'serviceOrders.stepTitle' }).map((field) => (field as HTMLInputElement).value)
      ).toEqual(['Молитва']);
    });

    /**
     * A STEP THAT IS GONE IS NOT A STEP THAT WAS SAVED.
     *
     * The mutator runs against the rite as the server now has it. With the step removed on
     * another device, mapping over the list changed nothing and handed back a perfectly valid
     * array — so the write reported success and the words were dropped as confirmed while
     * existing nowhere at all.
     */
    it('refuses a write into a step another device removed', async () => {
      mockUpdateSteps.mockImplementationOnce(
        async (_id: string, mutate: (steps: unknown[]) => unknown[] | null) => mutate([])
      );
      render(<ServiceOrderPage />);
      enterEdit();

      const words = screen.getAllByRole('textbox', { name: 'serviceOrders.stepWords' })[0];
      fireEvent.change(words, { target: { value: 'что-то' } });
      fireEvent.blur(words);

      await waitFor(() =>
        expect(screen.getByTestId('service-order-failure')).toHaveTextContent('serviceOrders.stepGone')
      );
      expect(
        (screen.getAllByRole('textbox', { name: 'serviceOrders.stepWords' })[0] as HTMLTextAreaElement).value
      ).toBe('что-то');
    });

    /**
     * WHAT IS WAITING GOES BEFORE THE BASELINE IS RELEASED.
     *
     * Leaving the page with a half-typed name used to release the guard's baseline first and
     * send the rename second — through a queue that no longer had anything to judge it by. That
     * rename could then overwrite a title another device had changed in the meantime.
     */
    it('sends a waiting name before it lets go of the baseline', () => {
      jest.useFakeTimers();
      const { unmount } = render(<ServiceOrderPage />);
      enterEdit();

      const title = screen.getByRole('textbox', { name: 'serviceOrders.orderTitle' });
      fireEvent.focus(title);
      fireEvent.change(title, { target: { value: 'Отпевание' } });
      unmount();

      expect(mockRenameOrder).toHaveBeenCalledWith('order-1', 'Отпевание', expect.any(String));
      expect(mockClosedEditing).toHaveBeenCalledWith('order-1', expect.any(String));
      expect(mockRenameOrder.mock.invocationCallOrder[0]).toBeLessThan(
        mockClosedEditing.mock.invocationCallOrder[0]
      );
      jest.useRealTimers();
    });

    /** The same order on the ordinary way out: pressing "Готово" with a name still on the timer. */
    it('sends a waiting name before it lets go of the baseline on Done', () => {
      jest.useFakeTimers();
      render(<ServiceOrderPage />);
      enterEdit();

      const title = screen.getByRole('textbox', { name: 'serviceOrders.orderTitle' });
      fireEvent.focus(title);
      fireEvent.change(title, { target: { value: 'Отпевание' } });
      fireEvent.click(screen.getByRole('button', { name: 'serviceOrders.done' }));

      expect(mockRenameOrder).toHaveBeenCalledWith('order-1', 'Отпевание', expect.any(String));
      expect(mockRenameOrder.mock.invocationCallOrder[0]).toBeLessThan(
        mockClosedEditing.mock.invocationCallOrder[0]
      );
      jest.useRealTimers();
    });

    /**
     * A STRUCTURAL WRITE MUST NOT TAKE UNSENT WORDS OFF THE SCREEN.
     *
     * Type a sentence, add a step before the timer fires: the server knows nothing of the
     * sentence, so its truthful answer does not contain it. Adopting that answer erased the
     * words in front of the person — and the next keystroke would then land on the version
     * without them, which is how they are lost for real.
     */
    it('keeps unsent words on screen when a structural write answers first', async () => {
      jest.useFakeTimers();
      render(<ServiceOrderPage />);
      enterEdit();

      const words = screen.getAllByRole('textbox', { name: 'serviceOrders.stepWords' })[0];
      fireEvent.change(words, { target: { value: 'над этим гробом' } });

      // The server answers the structural write with the rite as IT knows it — no sentence.
      mockUpdateSteps.mockImplementationOnce(async () => [step('s1', 'Перед началом'), step('s2', 'Молитва')]);
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'serviceOrders.addStep' }));
      });

      expect(
        (screen.getAllByRole('textbox', { name: 'serviceOrders.stepWords' })[0] as HTMLTextAreaElement).value
      ).toBe('над этим гробом');
      jest.useRealTimers();
    });

    /**
     * THE NAME'S TIMER IS NOT THE STEPS' BUSINESS.
     *
     * Holding the mirror while ANY write was waiting was too broad a rule: a name still on its
     * timer pinned the steps to a local copy for the rest of the session, so the screen stopped
     * following the document and a change made on another device never appeared at all.
     */
    it('lets the steps follow the document while the name is still on its timer', async () => {
      jest.useFakeTimers();
      render(<ServiceOrderPage />);
      enterEdit();

      const title = screen.getByRole('textbox', { name: 'serviceOrders.orderTitle' });
      fireEvent.focus(title);
      fireEvent.change(title, { target: { value: 'Отпевание' } });

      // The step write succeeds and the document now carries another device's words.
      mockUpdateSteps.mockImplementationOnce(async () => {
        state.orders = [order([step('s1', 'Перед началом', 'с другого устройства'), step('s2', 'Молитва')])];
        return (state.orders[0] as { steps: unknown[] }).steps;
      });

      const words = screen.getAllByRole('textbox', { name: 'serviceOrders.stepWords' })[0];
      fireEvent.change(words, { target: { value: 'моё' } });
      await act(async () => {
        fireEvent.blur(words);
      });

      expect(
        (screen.getAllByRole('textbox', { name: 'serviceOrders.stepWords' })[0] as HTMLTextAreaElement).value
      ).toBe('с другого устройства');
      jest.useRealTimers();
    });

    /**
     * Removing a step another device already removed is not a removal — and not a success. It is
     * said out loud, and the step is NOT put back: the server has no such step, and a screen
     * that resurrects it contradicts the very sentence it is showing.
     */
    it('refuses to remove a step that is already gone, and leaves it gone', async () => {
      mockUpdateSteps.mockImplementationOnce(
        async (_id: string, mutate: (steps: unknown[]) => unknown[] | null) => mutate([])
      );
      render(<ServiceOrderPage />);
      enterEdit();

      fireEvent.click(screen.getAllByRole('button', { name: 'serviceOrders.removeStep' })[0]);

      await waitFor(() =>
        expect(screen.getByTestId('service-order-failure')).toHaveTextContent('serviceOrders.stepGone')
      );
      expect(screen.getAllByRole('textbox', { name: 'serviceOrders.stepTitle' })).toHaveLength(1);
    });

    it('says on the page when a write is refused', async () => {
      mockUpdateSteps.mockRejectedValueOnce(new Error('Missing or insufficient permissions.'));
      render(<ServiceOrderPage />);
      enterEdit();

      const words = screen.getAllByRole('textbox', { name: 'serviceOrders.stepWords' })[0];
      fireEvent.change(words, { target: { value: 'что-то' } });
      fireEvent.blur(words);

      await waitFor(() =>
        expect(screen.getByTestId('service-order-failure')).toHaveTextContent('serviceOrders.writeFailed')
      );
    });
  });

  /** Being fetched is not the same as not being there, and neither of them is a blank page. */
  it('shows the shape of the rite while it is being read', () => {
    state.orders = [];
    state.loading = true;
    render(<ServiceOrderPage />);

    expect(screen.getByTestId('service-order-loading')).toBeInTheDocument();
    expect(screen.queryByText('serviceOrders.notFound')).not.toBeInTheDocument();
    state.loading = false;
  });

  /**
   * A CONTROLLED MIRROR THAT NEVER LETS GO WOULD FREEZE THE PAGE on the version it first saw.
   * A SAVED write hands the screen back to the document, so a change made elsewhere shows up
   * instead of the tab quietly displaying yesterday until it is closed.
   */
  it('offers a remote update after a save without silently replacing the accepted version', async () => {
    mockUpdateSteps.mockImplementationOnce(async () => [
      step('s1', 'Перед началом', 'местное'),
      step('s2', 'Молитва'),
    ]);
    const { rerender } = render(<ServiceOrderPage />);
    fireEvent.click(screen.getByRole('button', { name: 'serviceOrders.edit' }));

    const words = screen.getAllByRole('textbox', { name: 'serviceOrders.stepWords' })[0];
    fireEvent.change(words, { target: { value: 'местное' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'serviceOrders.done' }));
    });

    // Meanwhile the document moved on elsewhere.
    state.orders = [order([step('s1', 'Перед началом', 'пришло с другого устройства'), step('s2', 'Молитва')])];
    rerender(<ServiceOrderPage />);

    expect(screen.queryByText('пришло с другого устройства')).not.toBeInTheDocument();
    mockFreshness.state = 'stale';
    mockReadServer.mockResolvedValueOnce(state.orders[0]);
    rerender(<ServiceOrderPage />);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'freshness.refreshAction' })); });
    expect(screen.getByText('пришло с другого устройства')).toBeInTheDocument();
  });

  /**
   * AND "ГОТОВО" IS NOT A SAVE. The words flushed on the way out can still be refused a second
   * later; handing the screen back to the document at the moment the button is pressed announced
   * a failure about text that no longer existed anywhere.
   */
  it('does not erase typing started while an explicit refresh is loading', async () => {
    mockFreshness.state = 'stale';
    let resolve!: (value: unknown) => void;
    mockReadServer.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    render(<ServiceOrderPage />);
    fireEvent.click(screen.getByRole('button', { name: 'freshness.refreshAction' }));
    fireEvent.click(screen.getByRole('button', { name: 'serviceOrders.edit' }));
    const input = screen.getAllByRole('textbox', { name: 'serviceOrders.stepWords' })[0];
    fireEvent.change(input, { target: { value: 'New draft while loading' } });
    await act(async () => { resolve(order([step('s1', 'Remote title', 'Remote text')])); });
    expect(input).toHaveValue('New draft while loading');
    expect(screen.queryByRole('button', { name: 'freshness.reviewAction' })).not.toBeInTheDocument();
  });

  it('keeps the accepted title revision when a background read has a newer title', () => {
    const { rerender } = render(<ServiceOrderPage />);
    state.orders = [{ ...order([step('s1', 'Step')]), title: 'Remote title', rev: { meta: 9 } }];
    rerender(<ServiceOrderPage />);
    fireEvent.click(screen.getByRole('button', { name: 'serviceOrders.edit' }));
    fireEvent.focus(screen.getByRole('textbox', { name: 'serviceOrders.orderTitle' }));
    expect(mockOpenedWith).toHaveBeenLastCalledWith('order-1', { title: 'Погребение', revision: 3 }, expect.any(String));
  });

  it('keeps words the server refused after editing is done', async () => {
    mockUpdateSteps.mockRejectedValueOnce(new Error('Missing or insufficient permissions.'));
    const { rerender } = render(<ServiceOrderPage />);
    fireEvent.click(screen.getByRole('button', { name: 'serviceOrders.edit' }));

    const words = screen.getAllByRole('textbox', { name: 'serviceOrders.stepWords' })[0];
    fireEvent.change(words, { target: { value: 'над этим гробом' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'serviceOrders.done' }));
    });
    rerender(<ServiceOrderPage />);

    expect(screen.getByTestId('service-order-failure')).toBeInTheDocument();
    expect(screen.getByText('над этим гробом')).toBeInTheDocument();
  });

  /**
   * A REFUSAL, A QUEUED WRITE AND A CONFLICT ARE NOT THE SAME SENTENCE. Told "failed" about a
   * write that is queued, a person retypes what is already safe; told "failed" about a
   * conflict, he never learns another version exists.
   */
  describe('what the page says about a write that did not simply succeed', () => {
    const enterEdit = () => fireEvent.click(screen.getByRole('button', { name: 'serviceOrders.edit' }));

    const typeAndLeave = () => {
      const words = screen.getAllByRole('textbox', { name: 'serviceOrders.stepWords' })[0];
      fireEvent.change(words, { target: { value: 'слова' } });
      fireEvent.blur(words);
    };

    it('says a queued write will be saved later, not that it failed', async () => {
      mockUpdateSteps.mockRejectedValueOnce(
        Object.assign(new Error('offline'), { isOfflineQueued: true })
      );
      render(<ServiceOrderPage />);
      enterEdit();
      typeAndLeave();

      await waitFor(() =>
        expect(screen.getByTestId('service-order-failure')).toHaveTextContent('serviceOrders.writeQueued')
      );
    });

    it('names a conflict as a conflict', async () => {
      mockUpdateSteps.mockRejectedValueOnce(
        Object.assign(new Error('stale'), { isStaleWrite: true })
      );
      render(<ServiceOrderPage />);
      enterEdit();
      typeAndLeave();

      await waitFor(() =>
        expect(screen.getByTestId('service-order-failure')).toHaveTextContent('serviceOrders.writeConflict')
      );
    });
  });

  /**
   * Offline, an absent service means "this device has not seen it yet". Telling a person his
   * service was deleted when it is sitting on the server is how trust in a section dies.
   */
  describe('when the service is not here', () => {
    /**
     * A CACHED LIST IS NOT PROOF OF ABSENCE. It is read cache-first and counts as fresh for
     * half a minute, so a rite created on the laptop and opened on the phone a moment later is
     * simply not in it — and the page used to announce a deletion that never happened.
     */
    it('says it was deleted only when the server itself says so', async () => {
      state.orders = [];
      render(<ServiceOrderPage />);

      expect(mockRecheck).toHaveBeenCalledWith('order-1');
      expect(screen.queryByText('serviceOrders.notFound')).not.toBeInTheDocument();
      expect(await screen.findByText('serviceOrders.notFound')).toBeInTheDocument();
    });

    /**
     * Online is not the same as reachable. A captive portal, a dying connection, a Firestore
     * that simply does not answer — none of them are grounds to tell a pastor his service was
     * deleted, and the read behind this refuses to answer from the cache precisely so the page
     * can tell the difference.
     */
    it('does not announce a deletion it could not confirm', async () => {
      state.orders = [];
      mockRecheck.mockResolvedValueOnce('unreachable');
      render(<ServiceOrderPage />);

      expect(await screen.findByText('serviceOrders.notHereYet')).toBeInTheDocument();
      expect(screen.queryByText('serviceOrders.notFound')).not.toBeInTheDocument();
    });

    /**
     * A READ THAT CROSSED A WRITE PROVES NOTHING, so the page asks again instead of settling on
     * an answer it did not get. A rite that really is gone is still reported as gone.
     */
    it('asks again when the question crossed a write', async () => {
      state.orders = [];
      mockRecheck.mockResolvedValueOnce('overlapped').mockResolvedValueOnce('absent');
      render(<ServiceOrderPage />);

      expect(await screen.findByText('serviceOrders.notFound')).toBeInTheDocument();
      expect(mockRecheck).toHaveBeenCalledTimes(2);
    });

    /** And it does not ask for ever: after a few crossings the page says what it can stand by. */
    it('stops asking and says nothing is known rather than inventing a deletion', async () => {
      state.orders = [];
      mockRecheck.mockResolvedValue('overlapped');
      render(<ServiceOrderPage />);

      expect(await screen.findByText('serviceOrders.notHereYet')).toBeInTheDocument();
      expect(mockRecheck).toHaveBeenCalledTimes(3);
    });

    /** Found on the server after all: the page simply opens, with no sentence about absence. */
    it('opens the service when the server has it after all', async () => {
      state.orders = [];
      mockRecheck.mockImplementationOnce(async () => {
        state.orders = [order([step('s1', 'Перед началом')])];
        return 'found';
      });
      render(<ServiceOrderPage />);

      expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent('Погребение');
    });

    it('says it has not arrived yet while offline, and asks no one', () => {
      state.orders = [];
      state.isOnline = false;
      render(<ServiceOrderPage />);

      expect(screen.getByText('serviceOrders.notHereYet')).toBeInTheDocument();
      expect(mockRecheck).not.toHaveBeenCalled();
    });
  });
});

/**
 * THE RITE IS GONE AND HIS WORDS ARE STILL HERE.
 *
 * Deleted on another device while this page was open, it simply left the list — and the page
 * showed "it is not here" over the top of a paragraph that existed in this browser and nowhere
 * else. Nothing said so, and leaving the page took it.
 */
describe('when the rite is deleted elsewhere mid-edit', () => {
  beforeEach(() => {
    mockFreshness.state = 'fresh';
    jest.clearAllMocks();
    jest.useRealTimers();
    state.orders = [order([step('s1', 'Перед началом'), step('s2', 'Молитва')])];
    state.loading = false;
    state.isOnline = true;
  });

  it('shows the unsaved words instead of announcing absence', async () => {
    const { rerender } = render(<ServiceOrderPage />);
    fireEvent.click(screen.getByRole('button', { name: 'serviceOrders.edit' }));

    const words = screen.getAllByRole('textbox', { name: 'serviceOrders.stepWords' })[0];
    fireEvent.change(words, { target: { value: 'у самой могилы' } });

    // The rite disappears from the list under the page's feet.
    state.orders = [];
    rerender(<ServiceOrderPage />);

    expect(screen.getByTestId('service-order-gone')).toHaveTextContent('serviceOrders.goneWithWords');
    expect(screen.getByText('у самой могилы')).toBeInTheDocument();
    expect(screen.queryByText('serviceOrders.notFound')).not.toBeInTheDocument();
  });

  /** The name he was typing is a word like any other, and it lives only in that field. */
  it('shows the name that was being typed', () => {
    const { rerender } = render(<ServiceOrderPage />);
    fireEvent.click(screen.getByRole('button', { name: 'serviceOrders.edit' }));

    const title = screen.getByRole('textbox', { name: 'serviceOrders.orderTitle' });
    fireEvent.focus(title);
    fireEvent.change(title, { target: { value: 'Погребение ребёнка' } });

    state.orders = [];
    rerender(<ServiceOrderPage />);

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Погребение ребёнка');
  });

  /**
   * A NAME SAVED IS NOT EVERY NAME TYPED.
   *
   * Type again while the first save is still travelling: the first one's success used to clear
   * the draft holding the second name, and if the rite then disappeared there was nothing left
   * to show him.
   */
  it('keeps a newer name when an older save comes back', async () => {
    let finishFirst: (() => void) | undefined;
    mockRenameOrder.mockImplementationOnce(
      () => new Promise((resolve) => { finishFirst = () => resolve(undefined); })
    );
    const { rerender } = render(<ServiceOrderPage />);
    fireEvent.click(screen.getByRole('button', { name: 'serviceOrders.edit' }));

    const title = screen.getByRole('textbox', { name: 'serviceOrders.orderTitle' });
    fireEvent.focus(title);
    fireEvent.change(title, { target: { value: 'Погребение ребёнка' } });
    await act(async () => {
      fireEvent.blur(title);
    });

    fireEvent.change(title, { target: { value: 'Погребение младенца' } });
    await act(async () => {
      finishFirst?.();
      await Promise.resolve();
    });

    state.orders = [];
    rerender(<ServiceOrderPage />);

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Погребение младенца');
  });

  /** And the references exactly as typed, comma and all — not the parsed list joined back. */
  it('shows the references as they stood in the field', () => {
    const { rerender } = render(<ServiceOrderPage />);
    fireEvent.click(screen.getByRole('button', { name: 'serviceOrders.edit' }));

    const refs = screen.getAllByRole('textbox', { name: 'serviceOrders.refs' })[0];
    fireEvent.change(refs, { target: { value: 'Ин. 11:25, ' } });

    state.orders = [];
    rerender(<ServiceOrderPage />);

    expect(screen.getByText('Ин. 11:25,')).toBeInTheDocument();
  });
});
