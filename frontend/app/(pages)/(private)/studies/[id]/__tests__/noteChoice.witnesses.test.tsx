import { stand } from '@test-utils/noteChoiceStand';
import { ChoiceMachine, runChoiceHistory, type ChoiceAction } from '@test-utils/noteChoiceHistory';
import type { ChoiceOracle } from '@test-utils/noteChoiceOracles';

// Exact retained validation minima; always replay the live page and facade.
const witnesses: { name: string; oracle: ChoiceOracle; actions: ChoiceAction[] }[] = [
  {
    "name": "U115-01/1252208",
    "oracle": "C2",
    "actions": [
      {
        "kind": "holdTransport"
      },
      {
        "kind": "dictate",
        "word": "S1252208E1X"
      },
      {
        "kind": "phoneOther",
        "word": "S1252208E2X"
      },
      {
        "kind": "releaseTransport"
      },
      {
        "kind": "openNotice"
      },
      {
        "kind": "take"
      },
      {
        "kind": "confirmTake"
      }
    ]
  },
  {
    "name": "U121-01/1250027",
    "oracle": "C1",
    "actions": [
      {
        "kind": "holdTransport"
      },
      {
        "kind": "dictate",
        "word": "S1250027E3X"
      },
      {
        "kind": "phoneOther",
        "word": "S1250027E4X"
      },
      {
        "kind": "releaseTransport"
      },
      {
        "kind": "holdTransport"
      },
      {
        "kind": "openNotice"
      },
      {
        "kind": "keep"
      },
      {
        "kind": "phoneOther",
        "word": "S1250027E9X"
      },
      {
        "kind": "releaseTransport"
      },
      {
        "kind": "openNotice"
      },
      {
        "kind": "pauseKeep"
      }
    ]
  },
  {
    "name": "U123-01/1251211",
    "oracle": "C1",
    "actions": [
      {
        "kind": "type",
        "word": "S1251211E0X"
      },
      {
        "kind": "holdTransport"
      },
      {
        "kind": "timer"
      },
      {
        "kind": "phoneOther",
        "word": "S1251211E3X"
      },
      {
        "kind": "releaseTransport"
      },
      {
        "kind": "holdCollection"
      },
      {
        "kind": "openNotice"
      },
      {
        "kind": "holdTransport"
      },
      {
        "kind": "keep"
      },
      {
        "kind": "phoneOther",
        "word": "S1251211E9X"
      },
      {
        "kind": "releaseTransport"
      },
      {
        "kind": "openNotice"
      },
      {
        "kind": "pauseKeep"
      },
      {
        "kind": "deliverAll"
      }
    ]
  },
  {
    "name": "U123-01/1250336",
    "oracle": "C1",
    "actions": [
      {
        "kind": "type",
        "word": "S1250336E1X"
      },
      {
        "kind": "holdTransport"
      },
      {
        "kind": "timer"
      },
      {
        "kind": "phoneOther",
        "word": "S1250336E4X"
      },
      {
        "kind": "releaseTransport"
      },
      {
        "kind": "openNotice"
      },
      {
        "kind": "holdTransport"
      },
      {
        "kind": "keep"
      },
      {
        "kind": "phoneOther",
        "word": "S1250336E12X"
      },
      {
        "kind": "holdCollection"
      },
      {
        "kind": "releaseTransport"
      },
      {
        "kind": "openNotice"
      },
      {
        "kind": "pauseKeep"
      },
      {
        "kind": "deliverLatest"
      },
      {
        "kind": "timer"
      }
    ]
  },
  {
    "name": "U123-02/1250539",
    "oracle": "C2",
    "actions": [
      {
        "kind": "holdTransport"
      },
      {
        "kind": "type",
        "word": "S1250539E1X"
      },
      {
        "kind": "timer"
      },
      {
        "kind": "phoneOther",
        "word": "S1250539E3X"
      },
      {
        "kind": "releaseTransport"
      },
      {
        "kind": "holdCollection"
      },
      {
        "kind": "openNotice"
      },
      {
        "kind": "take"
      },
      {
        "kind": "confirmTake"
      }
    ]
  }
];

it.each(witnesses)('$name passes $oracle on the live tree', async ({ name, oracle, actions }) => {
  const row = await runChoiceHistory(actions, name);
  expect(row.invalid).toBeUndefined();
  expect(row.valid).toBe(true);
  expect(row.verdicts[oracle]).toBe('pass');
}, 60000);

// U130-01: exact 23 public actions retained by the independent break.
const u130Actions: ChoiceAction[] = [
  {
    "kind": "holdTransport"
  },
  {
    "kind": "type",
    "word": "S130E1X"
  },
  {
    "kind": "timer"
  },
  {
    "kind": "phoneOther",
    "word": "S130E3X"
  },
  {
    "kind": "releaseTransport"
  },
  {
    "kind": "holdTransport"
  },
  {
    "kind": "openNotice"
  },
  {
    "kind": "type",
    "word": "S130E7X"
  },
  {
    "kind": "pauseKeep"
  },
  {
    "kind": "timer"
  },
  {
    "kind": "resume"
  },
  {
    "kind": "phoneLive"
  },
  {
    "kind": "releaseTransport"
  },
  {
    "kind": "inlineKeep"
  },
  {
    "kind": "timer"
  },
  {
    "kind": "timer"
  },
  {
    "kind": "holdCollection"
  },
  {
    "kind": "openNotice"
  },
  {
    "kind": "take"
  },
  {
    "kind": "confirmTake"
  },
  {
    "kind": "timer"
  },
  {
    "kind": "type",
    "word": "S130E22X"
  },
  {
    "kind": "timer"
  }
];

it('U130-01 retains every word and converges without a manufactured question', async () => {
  const row = await runChoiceHistory(u130Actions, 'U130-01');
  const expected = 'Original paragraph.\n\nSecond paragraph. S130E1X S130E7X S130E22X';
  expect(row.invalid).toBeUndefined();
  expect(row.valid).toBe(true);
  expect(row.terminal.editor).toBe(expected);
  expect(row.terminal.stored).toBe(expected);
  expect(row.terminal.question).toBe(false);
  expect(row.terminal.sends).toBe(3);
}, 60000);

it('a real notice Take with unsubmitted edits causes no page render or autosave send', async () => {
  const machine = new ChoiceMachine();
  await machine.boot();
  try {
    // Exhaust the owed save's timers, then hold collection delivery before Take.
    for (const action of u130Actions.slice(0, 18)) await machine.step(action);
    const live = stand.autosave.liveValues!();
    expect(live.content).toContain('S130E7X');
    expect(stand.autosave.baselineRef.current?.content).not.toBe(live.content);
    const renders = stand.renderCount;
    const sends = machine.requests.length;
    await machine.step(u130Actions[18]);
    await machine.step(u130Actions[19]);
    expect(machine.answers.at(-1)).toMatchObject({ kind: 'take', surface: 'notice', completed: true });
    expect(stand.renderCount).toBe(renders);
    await machine.tick(1600);
    expect(stand.renderCount).toBe(renders);
    expect(machine.requests).toHaveLength(sends);
  } finally {
    machine.close();
  }
}, 60000);

it('adopts on an announcement after the row without waiting for another page render', async () => {
  const machine = new ChoiceMachine();
  await machine.boot();
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  try {
    for (const action of u130Actions.slice(0, 5)) await machine.step(action);
    const local = stand.autosave.liveValues!().content;
    const take = jest.mocked(stand.laptop.engine.takeStoredVersion);
    const performTake = take.getMockImplementation()!;
    let taken = false;
    take.mockImplementation(async (...args) => {
      const result = await performTake(...args);
      taken = true;
      // The real engine cancellation delivers its row before the facade announces.
      await gate;
      return result;
    });
    for (const kind of ['openNotice', 'take', 'confirmTake'] as const) await machine.step({ kind });
    expect(taken).toBe(true);
    const remote = 'Original paragraph.\n\nSecond paragraph. S130E3X';
    expect(stand.autosave.existingNote?.content).toBe(remote);
    expect(stand.autosave.liveValues!().content).toBe(local);
    expect(stand.autosave.baselineRef.current?.content).toBe(local);
    stand.holdCollection();
    release();
    await machine.tick();
    expect(stand.autosave.liveValues!().content).toBe(remote);
    expect(stand.confirmed?.content).toBe(remote);
  } finally {
    release();
    machine.close();
  }
}, 60000);
