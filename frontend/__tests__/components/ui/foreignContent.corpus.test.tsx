import { act, render } from '@testing-library/react';
import React from 'react';

import { applyForeignContent } from '@/components/ui/foreignContent';
import { RichMarkdownEditor } from '@/components/ui/RichMarkdownEditor';
import { position, productionArrival, productionDocument } from '@test-utils/foreignContent';
import { writeForeignEvidence } from '@test-utils/foreignContentEvidence';
import archivedPairs from '@test-utils/foreignContentPairs.json';
import { richMarkdownCorpus } from '@test-utils/richMarkdownCorpus';
import { mountedEditor } from '@test-utils/richMarkdownHistory';

jest.mock('@/components/ui/RichMarkdownToolbar', () => ({ RichMarkdownToolbar: () => null }));

it('equals the production document for every corpus pair and archived structural arrival on both selection paths', () => {
  const view = render(<RichMarkdownEditor value="Start" onChange={jest.fn()} />);
  const editor = mountedEditor(view.container);
  const documents = richMarkdownCorpus.concat([
    ['loose', '- First\n\n- Second'], ['tight', '- First\n- Second'], ['break', 'One  \nTwo'], ['empty', ''],
    ['empty paragraphs', '<p></p><p></p>'],
    ['link self', '<p><a href="https://example.invalid/a" target="_self" rel="author">Words</a></p>'],
    ['aligned table', '| A | B |\n| :--- | ---: |\n| left | right |'],
    ['html alignment', '<table><tr><th style="text-align:right">A</th></tr><tr><td style="text-align:center">B</td></tr></table>'],
  ]);
  const pairs = documents.flatMap(([a, from]) => documents.map(([b, to]) => [a + ' -> ' + b, from, to]));
  pairs.push(...archivedPairs.pairs.map(([name, a, b]) => [String(name), archivedPairs.documents[Number(a)], archivedPairs.documents[Number(b)]]));
  for (const heading of [
    '<h2>https://old.example.org</h2>',
    '<h2><a href="https://old.example.org">https://old.example.org</a></h2>',
  ]) {
    const from = `First\n\n<blockquote>${heading}<p>3</p></blockquote>\n\nSpacer\n\nWorking`;
    pairs.push(['normalization: ' + heading, from, from.replaceAll('old.example.org', 'new.example.org')]);
  }
  const fallbacks: string[] = [], unequal: string[] = [];
  let updates = 0;
  editor.on('update', () => { updates++; });
  for (const [name, from, to] of pairs) act(() => {
    productionArrival(editor, from);
    if (name.startsWith('normalization: ')) editor.commands.setTextSelection(position(editor, 'Working', 3));
    const expected = productionDocument(editor, to);
    const result = applyForeignContent(editor, to);
    if (result.fallback) fallbacks.push(name);
    if (!editor.state.doc.eq(expected)) unequal.push(name);
  });
  writeForeignEvidence('corpus', { documents: documents.length, matrix: documents.length ** 2,
    archivedPairs: archivedPairs.pairs.length, pairs: pairs.length, equal: pairs.length - unequal.length, fallbacks, unequal, updates });
  expect(unequal).toEqual([]);
  expect(fallbacks.length).toBeGreaterThan(0);
  expect(updates).toBe(0);
}, 180000);

it('bounds adoption cost for three changes in fifty five thousand characters and fifteen hundred changed nodes', () => {
  const view = render(<RichMarkdownEditor value="Start" onChange={jest.fn()} />);
  const editor = mountedEditor(view.container);
  const median = (values: number[]) => { const sorted = [...values].sort((a, b) => a - b); return (sorted[9] + sorted[10]) / 2; };
  const chunks = Array.from({ length: 300 }, (_, i) => (`Paragraph ${i}: ` + 'abcdef '.repeat(23)).padEnd(181, 'x'));
  chunks[299] += 'x'.repeat(55000 - chunks.join('\n\n').length);
  const source = chunks.join('\n\n');
  expect(source).toHaveLength(55000);
  const target = source.replace('Paragraph 20:', 'PHONE at 20:').replace('Paragraph 150:', 'PHONE at 150:').replace('Paragraph 280:', 'PHONE at 280:');
  const samples: { production: number[]; nodes: number[] } = { production: [], nodes: [] };
  for (let i = -4; i < 20; i++) for (const mode of i % 2 ? ['nodes', 'production'] as const : ['production', 'nodes'] as const) {
    act(() => { productionArrival(editor, source); });
    const start = performance.now();
    act(() => { if (mode === 'nodes') expect(applyForeignContent(editor, target).fallback).toBe(false); else productionArrival(editor, target); });
    if (i >= 0) samples[mode].push(performance.now() - start);
  }
  const stressSource = Array.from({ length: 1500 }, (_, i) => `Old ${i} short words`).join('\n\n');
  const stressTarget = stressSource.replace(/Old /g, 'PHONE ');
  const stress: Record<string, number> = {};
  for (const mode of ['production', 'nodes']) {
    act(() => { productionArrival(editor, stressSource); });
    const start = performance.now();
    act(() => { if (mode === 'nodes') expect(applyForeignContent(editor, stressTarget).fallback).toBe(true); else productionArrival(editor, stressTarget); });
    stress[mode] = performance.now() - start;
  }
  const ratio = median(samples.nodes) / median(samples.production);
  writeForeignEvidence('timing', { chars: source.length, changedNodes: 3, samples, medians: { production: median(samples.production), nodes: median(samples.nodes) }, ratio, stressNodes: 1500, stress, stressBudgetMs: 5000 });
  expect(ratio).toBeLessThanOrEqual(2);
  expect(stress.nodes).toBeLessThan(5000);
}, 180000);
