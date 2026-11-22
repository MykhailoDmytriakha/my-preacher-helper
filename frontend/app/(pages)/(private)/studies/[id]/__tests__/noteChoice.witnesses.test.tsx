import { stand } from '@test-utils/noteChoiceStand';
import { ChoiceMachine, runChoiceHistory, type ChoiceAction } from '@test-utils/noteChoiceHistory';
import type { ChoiceOracle } from '@test-utils/noteChoiceOracles';

// Retained validation histories replayed through the live note session. A mounted note owns its choice. The replacement is captured by its autosave timer.
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
        "kind": "inlineTake"
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
        "kind": "inlineKeep"
      },
      {
        "kind": "timer"
      },
      {
        "kind": "phoneOther",
        "word": "S1250027E9X"
      },
      {
        "kind": "releaseTransport"
      },
      {
        "kind": "pauseKeep"
      },
      {
        "kind": "timer"
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
        "kind": "holdTransport"
      },
      {
        "kind": "inlineKeep"
      },
      {
        "kind": "timer"
      },
      {
        "kind": "phoneOther",
        "word": "S1251211E9X"
      },
      {
        "kind": "releaseTransport"
      },
      {
        "kind": "pauseKeep"
      },
      {
        "kind": "timer"
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
        "kind": "holdTransport"
      },
      {
        "kind": "inlineKeep"
      },
      {
        "kind": "timer"
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
        "kind": "pauseKeep"
      },
      {
        "kind": "timer"
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
        "kind": "inlineTake"
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

// U130-01: retained cross-device history, with choices on the canonical note session.
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
    "kind": "timer"
  },
  {
    "kind": "timer"
  },
  {
    "kind": "holdCollection"
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
  const equalArrival = u130Actions.findIndex(({ kind }) => kind === 'phoneLive');
  const afterDelivery = row.checkpoints[equalArrival + 1];
  expect(u130Actions[equalArrival + 1].kind).toBe('releaseTransport');
  expect(afterDelivery).toMatchObject({
    editor: 'Original paragraph.\n\nSecond paragraph. S130E1X S130E7X',
    question: false,
  });
  expect(row.terminal.question).toBe(false);
  expect(row.terminal.sends).toBeLessThanOrEqual(3);
}, 60000);

it('taking the stored body leaves later unsubmitted words in their own comparison', async () => {
  const machine = new ChoiceMachine();
  await machine.boot();
  try {
    for (const action of u130Actions.slice(0, 4)) await machine.step(action);
    await machine.step({ kind: 'type', word: 'Laterword' });
    await machine.step({ kind: 'releaseTransport' });
    await machine.step({ kind: 'holdCollection' });
    const sends = machine.requests.length;
    await machine.step({ kind: 'inlineTake' });
    await machine.step({ kind: 'confirmTake' });
    expect(machine.answers.at(-1)).toMatchObject({ kind: 'take', surface: 'inline', completed: true });
    await machine.tick(1600);
    expect(machine.requests).toHaveLength(sends);
    expect(machine.steps.at(-1)).toMatchObject({ question: true, stored: 'Original paragraph.\n\nSecond paragraph. S130E3X' });
    expect(stand.autosave.liveValues().content).toContain('Laterword');
  } finally {
    machine.close();
  }
}, 60000);

it('takes the stored words through the editor while collection notifications are held', async () => {
  const machine = new ChoiceMachine();
  await machine.boot();
  try {
    for (const action of u130Actions.slice(0, 5)) await machine.step(action);
    const remote = 'Original paragraph.\n\nSecond paragraph. S130E3X';
    expect(stand.autosave.liveValues().content).not.toBe(remote);
    await machine.step({ kind: 'holdCollection' });
    await machine.step({ kind: 'inlineTake' });
    await machine.step({ kind: 'confirmTake' });
    expect(machine.answers.at(-1)).toMatchObject({ kind: 'take', surface: 'inline', completed: true });
    expect(stand.collectionHeld).toBe(true);
    expect(stand.autosave.liveValues().content).toBe(remote);
    expect(stand.confirmed?.content).toBe(remote);
    expect(machine.steps.at(-1)).toMatchObject({ editor: remote, question: false });
    await machine.step({ kind: 'deliverAll' });
    expect(machine.steps.at(-1)).toMatchObject({ editor: remote, question: false });
  } finally {
    machine.close();
  }
}, 60000);
