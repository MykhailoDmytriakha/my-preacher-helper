// Runs against the REAL react-markdown, not the global stub in jest.setup.js: the attributes are added after the
// shared safe HTML pass, and that pass is what would strip them.
jest.unmock('react-markdown');
jest.unmock('remark-gfm');
jest.unmock('rehype-raw');
jest.unmock('rehype-sanitize');

import { render, screen } from '@testing-library/react';

import MarkdownDisplay from '@components/MarkdownDisplay';
import { rehypeTableRecords } from '@/utils/rehypeTableRecords';

import type { Element, Root } from 'hast';

/*
 * A table too narrow for its box reads as records — the row's name, then each filled cell under its column's
 * heading (owner, 2026-11-21). The layout is CSS; these tests hold the names it reads.
 */
it('names a GFM table\'s records: the row\'s first cell, and every other cell by its column', () => {
  render(<MarkdownDisplay content={'| | Братьям | Сёстрам |\n| --- | --- | --- |\n| Порядок | 1 Кор. 11:3 | Еф. 5:22 |'} />);
  const table = screen.getByRole('table');
  expect(table).toHaveAttribute('data-records');
  expect(table.parentElement).toHaveClass('md-table-box');
  expect(table.querySelector('thead tr')).toHaveAttribute('data-record-head');
  expect(screen.getByText('Порядок')).toHaveAttribute('data-record-title');
  expect(screen.getByText('1 Кор. 11:3')).toHaveAttribute('data-record-label', 'Братьям');
  expect(screen.getByText('Еф. 5:22')).toHaveAttribute('data-record-label', 'Сёстрам');
});

it('reads a table the editor saved as HTML: the first row heads it, a blank first column is skipped', () => {
  // The shape a hand-edited plan table took on the owner's sermon: an empty first column, the heading row in tbody.
  const html = '<table><tbody>'
    + '<tr><th><p></p></th><td><p>&nbsp;</p></td><td><p>Братьям</p></td><td><p>Сёстрам</p></td></tr>'
    + '<tr><td><p></p></td><td><p>Дети</p></td><td><p>Евр. 11:7</p></td><td><p>2 Тим. 1:5</p></td></tr>'
    + '</tbody></table>';
  const { container } = render(<MarkdownDisplay content={html} />);
  const rows = container.querySelectorAll('tr');
  expect(rows[0]).toHaveAttribute('data-record-head');
  const cells = rows[1].querySelectorAll('td');
  expect(cells[0]).toHaveAttribute('data-record-empty');
  expect(cells[1]).toHaveAttribute('data-record-title');
  expect(cells[2]).toHaveAttribute('data-record-label', 'Братьям');
  expect(cells[3]).toHaveAttribute('data-record-label', 'Сёстрам');
});

describe('only a table with a certain heading row reads as records (Codex review, 2026-11-21)', () => {
  it('leaves a headless HTML table, and one with a merged cell, as an ordinary scrolling table', () => {
    const { container } = render(<MarkdownDisplay content={'<table><tbody><tr><td>a</td><td>b</td></tr><tr><td>c</td><td>d</td></tr></tbody></table>\n\n<table><thead><tr><th>A</th><th>B</th></tr></thead><tbody><tr><td colspan="2">wide</td></tr></tbody></table>\n\n<table><thead><tr><th>A</th><th>B</th><th>C</th></tr></thead><tbody><tr><td rowspan="0">long</td><td>b</td><td>c</td></tr><tr><td>Bob</td><td>x</td></tr></tbody></table>'} />);
    container.querySelectorAll('table').forEach((table) => expect(table).not.toHaveAttribute('data-records'));
  });

  it('does not hide a cell that holds a picture and no words', () => {
    const { container } = render(<MarkdownDisplay content={'| | Фото |\n| --- | --- |\n| Ной | ![ковчег](https://example.com/ark.png) |'} />);
    const cells = container.querySelectorAll('tbody td');
    expect(cells[1]).not.toHaveAttribute('data-record-empty');
    expect(cells[1]).toHaveAttribute('data-record-label', 'Фото');
  });
});

it('does not read a table with two heading rows as records, with or without a thead', () => {
  const { container } = render(<MarkdownDisplay content={'<table><tbody><tr><th>Group</th><th>People</th></tr><tr><th>Name</th><th>Age</th></tr><tr><td>Ada</td><td>20</td></tr></tbody></table>'} />);
  expect(container.querySelector('table')).not.toHaveAttribute('data-records');
});

it('does not read a heading row hidden in the body as a record either', () => {
  const { container } = render(<MarkdownDisplay content={'<table><thead><tr><th></th><th>Husbands</th></tr></thead><tbody><tr><th>When</th><th>Before marriage</th></tr><tr><td>Order</td><td>Eph 5:25</td></tr></tbody></table>'} />);
  expect(container.querySelector('table')).not.toHaveAttribute('data-records');
});

it('keeps a value\'s heading when the row has no name of its own', () => {
  const { container } = render(<MarkdownDisplay content={'| | Husbands | Wives |\n| --- | --- | --- |\n| | Lead | Listen |'} />);
  const cells = container.querySelectorAll('tbody td');
  expect(cells[1]).toHaveAttribute('data-record-label', 'Husbands');
  expect(cells[2]).toHaveAttribute('data-record-label', 'Wives');
  expect(container.querySelector('[data-record-title]')).toBeNull();
});

it('reads a heading that is a picture by its description, and keeps it over its value', () => {
  const { container } = render(<MarkdownDisplay content={'| | ![Husbands](https://example.com/h.png) | Wives |\n| --- | --- | --- |\n| | Lead | Listen |'} />);
  const cells = container.querySelectorAll('tbody td');
  expect(cells[1]).toHaveAttribute('data-record-label', 'Husbands');
  expect(container.querySelector('[data-record-title]')).toBeNull();
});

it('reads a picture heading by its description with blank space around it', () => {
  const { container } = render(<MarkdownDisplay content={'| | &nbsp;![Husbands](/h.png) | Wives |\n| --- | --- | --- |\n| | Lead | Listen |'} />);
  expect(container.querySelectorAll('tbody td')[1]).toHaveAttribute('data-record-label', 'Husbands');
});

it('marks a very long table without failing', () => {
  const cell = (tagName: string, text: string): Element => ({ type: 'element', tagName, properties: {}, children: [{ type: 'text', value: text }] });
  const row = (tagName: string, text: string): Element => ({ type: 'element', tagName: 'tr', properties: {}, children: [cell(tagName, text)] });
  const body = Array.from({ length: 200000 }, () => row('td', 'x'));
  const table: Element = { type: 'element', tagName: 'table', properties: {}, children: [
    { type: 'element', tagName: 'thead', properties: {}, children: [row('th', 'H')] },
    { type: 'element', tagName: 'tbody', properties: {}, children: body },
  ] };
  expect(() => rehypeTableRecords()({ type: 'root', children: [table] } as Root)).not.toThrow();
  expect(table.properties).toHaveProperty('dataRecords');
});
