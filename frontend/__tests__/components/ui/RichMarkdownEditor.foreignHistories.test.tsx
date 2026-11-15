import { act, render } from '@testing-library/react';
import React from 'react';

import { RichMarkdownEditor } from '@/components/ui/RichMarkdownEditor';
import { blocks, nodes, productionDocument, structuralInitial } from '@test-utils/foreignContent';
import crashHistory from '@test-utils/foreignContentCrashHistory.json';
import { writeForeignEvidence } from '@test-utils/foreignContentEvidence';
import { arrivalValue, executeOwn, operationKinds, randomSource } from '@test-utils/foreignContentHistories';
import { markdown, mountedEditor } from '@test-utils/richMarkdownHistory';

import type { HistoryOperation } from '@test-utils/foreignContentHistories';

jest.mock('@/components/ui/RichMarkdownToolbar', () => ({ RichMarkdownToolbar: () => null }));

it('replays a structural history with formerly invalid mapped Undo without throwing or erasing arrivals', () => {
  const view = render(<RichMarkdownEditor value={structuralInitial} onChange={jest.fn()} />);
  const editor = mountedEditor(view.container);
  for (const op of crashHistory) {
    if (op.kind.startsWith('arrival')) {
      const value = arrivalValue(editor, op);
      let expected = editor.state.doc;
      act(() => { if (value !== markdown(editor)) expected = productionDocument(editor, value); });
      view.rerender(<RichMarkdownEditor value={value} onChange={jest.fn()} />);
      expect(editor.state.doc.eq(expected)).toBe(true);
    } else {
      act(() => { executeOwn(editor, op); });
      view.rerender(<RichMarkdownEditor value={markdown(editor)} onChange={jest.fn()} />);
    }
  }
  expect(editor.state.doc.childCount).toBeGreaterThan(0);
});

it('keeps arrived nodes through Undo and Redo across five thousand mixed structural steps', () => {
  const rows = [];
  for (const seed of [1, 42, 104729, 20261114, 3735928559]) {
    const random = randomSource(seed), change = jest.fn();
    const view = render(<RichMarkdownEditor value={structuralInitial} onChange={change} />);
    const editor = mountedEditor(view.container);
    const protectedNodes = new Map<string, string>();
    const counts: Record<string, number> = {}, changed: Record<string, number> = {};
    let arrivals = 0, protectedChecks = 0, successfulUndoRedo = 0, rangeTypings = 0;
    const tokens = (text: string): string[] => text.match(/ARR\d+X\d+X\d+/g) ?? [];
    for (let step = 0; step < 1000; step++) {
      const op: HistoryOperation = { kind: operationKinds[random() % operationKinds.length], a: random() % 100,
        b: random() % 100, c: random() % 100, id: `${seed}X${step}` };
      const before = editor.state.doc;
      counts[op.kind] = (counts[op.kind] ?? 0) + 1;
      if (op.kind.startsWith('arrival') || op.kind === 'selectArrivalType') {
        if (op.kind === 'selectArrivalType') {
          const bs = blocks(editor), first = bs[0], last = bs[bs.length - 1];
          if (editor.state.doc.childCount < 2) continue;
          const from = first.pos + op.b % (first.size + 1), to = last.pos + op.c % (last.size + 1);
          act(() => { editor.commands.setTextSelection(op.a % 2 ? { from: to, to: from } : { from, to }); });
        }
        const value = arrivalValue(editor, op.kind === 'selectArrivalType' ? { ...op, kind: 'arrivalInsert', a: 1 } : op);
        let expected = before;
        act(() => { if (value !== markdown(editor)) expected = productionDocument(editor, value); });
        change.mockClear();
        view.rerender(<RichMarkdownEditor value={value} onChange={change} />);
        expect({ seed, step, equal: editor.state.doc.eq(expected) }).toEqual({ seed, step, equal: true });
        expect(change).not.toHaveBeenCalled();
        arrivals++;
        const expectedNodes = nodes(expected);
        for (const token of protectedNodes.keys()) if (!expectedNodes.some(node => tokens(node.textContent).includes(token))) protectedNodes.delete(token);
        for (const node of expectedNodes) for (const token of tokens(node.textContent)) {
          if (token.startsWith(`ARR${op.id}X`)) protectedNodes.set(token, JSON.stringify(node.toJSON()));
        }
        if (op.kind === 'selectArrivalType') {
          // The character uses the selection left by the arrival, with no explicit reselection.
          act(() => { editor.commands.insertContent('X'); });
          const actual = nodes(editor.state.doc);
          for (const node of expectedNodes.filter(node => tokens(node.textContent).some(token => token.startsWith(`ARR${op.id}X`)))) {
            expect({ seed, step, arrived: actual.filter(candidate => candidate.eq(node)).map(candidate => candidate.toJSON()) })
              .toEqual({ seed, step, arrived: [node.toJSON()] });
            protectedChecks++;
          }
          for (const [token, saved] of protectedNodes) {
            if (!actual.some(node => tokens(node.textContent).includes(token) && JSON.stringify(node.toJSON()) === saved)) protectedNodes.delete(token);
          }
          view.rerender(<RichMarkdownEditor value={markdown(editor)} onChange={change} />);
          rangeTypings++;
        }
      } else {
        let success = false;
        act(() => { success = executeOwn(editor, op); });
        view.rerender(<RichMarkdownEditor value={markdown(editor)} onChange={change} />);
        const actual = nodes(editor.state.doc);
        if (op.kind === 'undo' || op.kind === 'redo') {
          if (success) successfulUndoRedo++;
          // Full node equality proves every arrived word remains, with no duplicate or contamination.
          for (const [token, saved] of protectedNodes) {
            const found = actual.filter(node => tokens(node.textContent).includes(token));
            expect({ seed, step, token, nodes: found.map(node => JSON.stringify(node.toJSON())) })
              .toEqual({ seed, step, token, nodes: [saved] });
            protectedChecks++;
          }
        } else for (const [token, saved] of protectedNodes) {
          if (!actual.some(node => tokens(node.textContent).includes(token) && JSON.stringify(node.toJSON()) === saved)) protectedNodes.delete(token);
        }
      }
      if (!before.eq(editor.state.doc)) changed[op.kind] = (changed[op.kind] ?? 0) + 1;
    }
    rows.push({ seed, steps: 1000, arrivals, protectedChecks, successfulUndoRedo, rangeTypings, counts, changed, exceptions: 0, lostWords: 0 });
    view.unmount();
  }
  writeForeignEvidence('random', rows);
  expect(rows.reduce((total, row) => total + row.steps, 0)).toBe(5000);
  expect(rows.reduce((total, row) => total + row.protectedChecks, 0)).toBeGreaterThan(100);
  expect(rows.reduce((total, row) => total + row.rangeTypings, 0)).toBeGreaterThan(100);
  for (const kind of operationKinds) expect(rows.reduce((total, row) => total + (row.changed[kind] ?? 0), 0)).toBeGreaterThan(0);
}, 180000);
