import { MarkWriter, type MarksChange } from '@/components/bible/marks/markWriter';

import type { BookMarks } from '@/utils/bibleMarks';

/*
 * One writer per book: strokes made quickly reach the engine one batch at a time (the owner's iPad,
 * 2026-10-16 — strokes sent side by side were answered "conflict" and the marks were gone).
 */
// A stroke as the reader makes one: painting words already painted changes nothing.
const paint = (verse: string, word: number): MarksChange => (marks) => {
  const runs = marks[verse]?.m ?? [];
  if (runs.some(([first, , color]) => first === word && color === 'red')) return marks;
  return { ...marks, [verse]: { m: [...runs.filter(([first]) => first !== word), [word, word, 'red']] } };
};

function deferred() {
  let resolve!: () => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('the writer of a book\'s marks', () => {
  it('sends one batch at a time; strokes made meanwhile go together in the next', async () => {
    const sent: { change: MarksChange; answer: ReturnType<typeof deferred> }[] = [];
    const writer = new MarkWriter();
    writer.connect((change) => {
      const answer = deferred();
      sent.push({ change, answer });
      return answer.promise;
    }, jest.fn());
    writer.push(paint('1:1', 0));
    writer.push(paint('1:1', 1));
    writer.push(paint('1:1', 2));
    expect(sent).toHaveLength(1);
    expect(sent[0].change({})).toEqual({ '1:1': { m: [[0, 0, 'red']] } });
    sent[0].answer.resolve();
    await flush();
    expect(sent).toHaveLength(2);
    // The next batch is laid over the copy that already holds the first.
    expect(sent[1].change(sent[0].change({}))).toEqual({ '1:1': { m: [[0, 0, 'red'], [1, 1, 'red'], [2, 2, 'red']] } });
  });

  it('shows strokes until the stored marks hold them, then lets them go', async () => {
    const answer = deferred();
    const writer = new MarkWriter();
    writer.connect(() => answer.promise, jest.fn());
    writer.push(paint('2:1', 3));
    const stored: BookMarks = {};
    expect(writer.overlay(stored)).toEqual({ '2:1': { m: [[3, 3, 'red']] } });
    answer.resolve();
    await flush();
    // Kept, but the list came back a step behind: the stroke stays on the page.
    writer.settle(stored);
    expect(writer.overlay(stored)).toEqual({ '2:1': { m: [[3, 3, 'red']] } });
    const holding: BookMarks = { '2:1': { m: [[3, 3, 'red']] } };
    writer.settle(holding);
    expect(writer.overlay({})).toEqual({});
  });

  it('waits while the device\'s storage does not answer, and drops a stroke refused for any other reason', async () => {
    const later: (() => void)[] = [];
    const refused = jest.fn();
    const send = jest.fn()
      .mockRejectedValueOnce(Object.assign(new Error('storage'), { code: 'storage-silent' }))
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(Object.assign(new Error('no'), { code: 'permission-denied' }));
    const writer = new MarkWriter(Date.now, (run) => { later.push(run); });
    writer.connect(send, refused);
    writer.push(paint('3:1', 0));
    await flush();
    expect(later).toHaveLength(1);
    expect(writer.overlay({})).toEqual({ '3:1': { m: [[0, 0, 'red']] } });
    later[0]();
    await flush();
    expect(send).toHaveBeenCalledTimes(2);
    expect(refused).not.toHaveBeenCalled();
    writer.push(paint('3:2', 1));
    await flush();
    expect(refused).toHaveBeenCalledWith(expect.objectContaining({ code: 'permission-denied' }));
    expect(writer.overlay({ '3:1': { m: [[0, 0, 'red']] } })).toEqual({ '3:1': { m: [[0, 0, 'red']] } });
  });

  it('is free again after a send that throws at once', async () => {
    const refused = jest.fn();
    const send = jest.fn()
      .mockImplementationOnce(() => { throw Object.assign(new Error('broken'), { code: 'internal' }); })
      .mockResolvedValueOnce(undefined);
    const writer = new MarkWriter();
    writer.connect(send, refused);
    writer.push(paint('4:1', 0));
    await flush();
    expect(refused).toHaveBeenCalledTimes(1);
    writer.push(paint('4:2', 1));
    await flush();
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('sees a stroke kept whatever order the stored verses come in', async () => {
    const writer = new MarkWriter();
    writer.connect(() => Promise.resolve(), jest.fn());
    writer.push(paint('5:1', 0));
    await flush();
    writer.settle({ '9:9': { p: [[0, 0, 'gray']] }, '5:1': { m: [[0, 0, 'red']] } });
    expect(writer.overlay({})).toEqual({});
  });

  it('lets a kept stroke go when its grace ends, though nothing else moves', async () => {
    let now = 0;
    const later: { run: () => void; ms: number }[] = [];
    const writer = new MarkWriter(() => now, (run, ms) => { later.push({ run, ms }); });
    writer.connect(() => Promise.resolve(), jest.fn());
    writer.push(paint('6:1', 0));
    await flush();
    // Another device changed the word meanwhile: the stored marks never come to hold the stroke.
    const stored: BookMarks = { '6:1': { m: [[0, 0, 'blue']] } };
    writer.settle(stored);
    expect(writer.overlay(stored)['6:1'].m).toContainEqual([0, 0, 'red']);
    expect(later).toHaveLength(1);
    now = later[0].ms;
    const before = writer.version;
    later[0].run();
    expect(writer.version).toBeGreaterThan(before);
    writer.settle(stored);
    expect(writer.overlay(stored)).toEqual(stored);
  });
});

