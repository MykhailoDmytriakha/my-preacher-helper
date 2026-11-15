import { Editor } from '@tiptap/core';
import { redoDepth, undoDepth } from '@tiptap/pm/history';
import { AllSelection, NodeSelection, TextSelection } from '@tiptap/pm/state';
import { CellSelection } from '@tiptap/pm/tables';

import { applyForeignContent } from '@/components/ui/foreignContent';
import { richMarkdownExtensions } from '@/components/ui/richMarkdownExtensions';
import { alignSequences } from '@/utils/alignSequences';
import { blocks, nodes, productionArrival, structuralInitial } from '@test-utils/foreignContent';
import { writeForeignEvidence } from '@test-utils/foreignContentEvidence';
import { arrivalValue, executeOwn, randomSource } from '@test-utils/foreignContentHistories';
import { baseSnapshot, exactSelection, nestedArrival, nextAction } from '@test-utils/foreignSelection';

it('matches the exact selection rule or production at every arrival in twenty thousand mixed history steps', () => {
  const summaries = [];
  for (const seed of [80, 801, 8011, 801114, 4294967211]) {
    const random = randomSource(seed);
    let updates = 0, nodePath = 0, fallback = 0, exceptions = 0, immediateChecks = 0;
    const counts: Record<string, number> = {}, selections: Record<string, number> = {};
    const editor = new Editor({ extensions: richMarkdownExtensions(), content: structuralInitial, onUpdate: () => updates++ });
    editor.view.setProps({ handleScrollToSelection: () => true });
    let pending: ReturnType<typeof baseSnapshot> | null = null;
    let pendingFallback = false;
    let protectedArrival: ReturnType<typeof nodes> = [];
    let protectedChecks = 0;
    for (let step = 0; step < 4000; step++) {
      const draw = random() % 100, a = random() % 100, b = random() % 100, c = random() % 100, id = `${seed}X${step}`;
      let kind = draw < 30 ? ['arrivalReplace', 'arrivalInsert', 'arrivalDelete', 'arrivalReorder', 'arrivalTable', 'arrivalList', 'arrivalDuplicate'][draw % 7]
        : draw < 50 ? ['type', 'Backspace', 'Delete', 'Enter', 'paste'][draw % 5]
          : draw < 58 ? ['undo', 'redo'][draw % 2] : draw < 72 ? 'selection'
            : ['type', 'split', 'join', 'delete3', 'list', 'indent', 'cell', 'paste'][draw % 8];
      if (pending) kind = ['type', 'Backspace', 'Delete', 'Enter', 'paste', 'undo', 'redo'][random() % 7];
      if (step === 3999 && kind.startsWith('arrival')) kind = 'type';
      counts[kind] = (counts[kind] ?? 0) + 1;
      const source = editor.state;
      const context = { seed, step, kind };
      if (kind.startsWith('arrival')) {
        const value = kind === 'arrivalTable' || kind === 'arrivalList' ? nestedArrival(editor, kind, id, a) : arrivalValue(editor, { kind, a, b, c, id });
        const base = baseSnapshot(editor, value);
        const beforeNodes = nodes(source.doc), arrivedNodes = nodes(base.doc);
        const runs = alignSequences(beforeNodes, arrivedNodes, (a, b) => a.eq(b));
        protectedArrival = runs.flatMap(run => arrivedNodes.slice(run.newFrom, run.newTo));
        const exact = exactSelection(source, base.doc), quiet = updates;
        const result = applyForeignContent(editor, value);
        expect({ ...context, equal: editor.state.doc.eq(base.doc) }).toEqual({ ...context, equal: true });
        if (result.fallback) {
          fallback++;
          expect(editor.state.doc.toJSON()).toEqual(base.doc.toJSON());
          expect(editor.state.selection.toJSON()).toEqual(base.selection);
        } else {
          nodePath++;
          expect(exact).not.toBeNull();
          expect(editor.state.storedMarks).toBe(source.storedMarks);
          expect({ ...context, selection: editor.state.selection.toJSON() }).toEqual({ ...context, selection: exact });
        }
        // The installed extensions are expected to use the node path for every exact case.
        expect(result.fallback).toBe(exact === null);
        expect(updates).toBe(quiet);
        expect([undoDepth(editor.state), redoDepth(editor.state)]).toEqual([0, 0]);
        pending = base; pendingFallback = result.fallback;
      } else if (kind === 'selection') {
        const bs = blocks(editor), x = bs[a % bs.length], y = bs[b % bs.length];
        if (c % 10 === 0) editor.view.dispatch(editor.state.tr.setSelection(new AllSelection(editor.state.doc)));
        else if (c % 10 === 1) {
          const cells: number[] = [];
          editor.state.doc.descendants((node, pos) => { if (['tableCell', 'tableHeader'].includes(node.type.name)) cells.push(pos); });
          if (cells.length) {
            const anchor = cells[a % cells.length];
            const table = editor.state.doc.resolve(anchor).node(-1);
            const siblings = cells.filter(pos => editor.state.doc.resolve(pos).node(-1) === table);
            editor.view.dispatch(editor.state.tr.setSelection(CellSelection.create(editor.state.doc, anchor, siblings[b % siblings.length])));
          } else editor.view.dispatch(editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, 0)));
        } else if (c % 10 === 2) editor.view.dispatch(editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, 0)));
        else editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, x.pos + c % (x.size + 1), y.pos + a % (y.size + 1))));
        const selected = editor.state.selection.toJSON().type + (editor.state.selection instanceof TextSelection ? editor.state.selection.empty ? ' caret' : ' range' : '');
        selections[selected] = (selections[selected] ?? 0) + 1;
      } else {
        const inherited = pending !== null || kind === 'undo' || kind === 'redo' || draw < 50;
        const action = () => inherited ? nextAction(editor, kind) : executeOwn(editor, { kind, a, b, c, id });
        // A same-state BASE control for every own step; after arrivals use BASE's arrival state.
        editor.view.updateState(pending?.state ?? source);
        let baseError: unknown, baseDoc, baseSelection;
        try { action(); baseDoc = editor.state.doc.toJSON(); baseSelection = editor.state.selection.toJSON(); } catch (error) { baseError = String(error); }
        editor.view.updateState(source);
        let currentError: unknown;
        try { action(); } catch (error) { currentError = String(error); exceptions++; }
        expect({ ...context, error: currentError }).toEqual({ ...context, error: currentError === undefined ? undefined : baseError });
        if (pendingFallback) {
          expect(currentError).toBe(baseError);
          expect(editor.state.doc.toJSON()).toEqual(baseDoc);
          expect(editor.state.selection.toJSON()).toEqual(baseSelection);
          immediateChecks++;
        } else if (pending && !currentError) {
          const actual = nodes(editor.state.doc);
          for (const node of protectedArrival) {
            expect(actual.filter(candidate => candidate.eq(node)).length)
              .toBeGreaterThanOrEqual(protectedArrival.filter(candidate => candidate.eq(node)).length);
            protectedChecks++;
          }
        }
        pending = null; pendingFallback = false;
      }
      if (!pending && editor.state.doc.content.size > 16000) { productionArrival(editor, structuralInitial); pending = null; pendingFallback = false; }
    }
    summaries.push({ seed, steps: 4000, nodePath, fallback, exceptions, immediateChecks, protectedChecks, counts, selections });
    editor.destroy();
  }
  writeForeignEvidence('v4-random', summaries);
  expect(summaries.reduce((n, row) => n + row.steps, 0)).toBe(20000);
  expect(summaries.reduce((n, row) => n + row.nodePath, 0)).toBeGreaterThan(100);
  expect(summaries.reduce((n, row) => n + row.fallback, 0)).toBeGreaterThan(100);
  for (const type of ['text caret', 'text range', 'all', 'node', 'cell']) {
    expect(summaries.reduce((n, row) => n + (row.selections[type] ?? 0), 0)).toBeGreaterThan(0);
  }
}, 240000);
