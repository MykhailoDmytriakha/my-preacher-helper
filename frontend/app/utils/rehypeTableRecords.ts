import type { Element, ElementContent, Root, RootContent } from 'hast';

/**
 * A TABLE THAT DOES NOT FIT READS AS RECORDS (owner, 2026-11-21: «если таблица не помещается, он её через черту
 * проводит» — as Claude Code prints a wide table in a terminal). This pass only names the parts; the narrow layout
 * itself is CSS (`.md-table-box` in `globals.css`), so a wide box keeps the ordinary table:
 *
 *   Порядок                      ← the row's first filled cell, under a blank heading: the record's name
 *   Братьям: 1 Кор. 11:3: «…»    ← every other filled cell, under its column's heading
 *   Сёстрам: Еф. 5:22: «…»
 *   ─────────
 *
 * The first row is the heading row (a GFM table's thead, or the first row of an HTML table the editor wrote); empty
 * cells — an editor's blank first column, a `&nbsp;` — are marked so the record skips them.
 */
const isElement = (node: RootContent | ElementContent): node is Element => node.type === 'element';

const textOf = (node: ElementContent | Root): string => {
  if (node.type === 'text') return node.value;
  if ('children' in node) return (node.children as ElementContent[]).map(textOf).join('');
  return '';
};

const filled = (text: string): boolean => text.replace(/\u00a0/g, ' ').trim() !== '';

/** A cell holds something when it has words or a picture, a figure, a control — not only when it has text. */
const holdsContent = (cell: Element): boolean => {
  if (filled(textOf(cell))) return true;
  const visit = (node: ElementContent): boolean => node.type === 'element'
    && (['img', 'picture', 'svg', 'video', 'audio', 'iframe', 'input', 'math'].includes(node.tagName) || node.children.some(visit));
  return cell.children.some(visit);
};

/** What a heading cell says: its words, else the description of its picture. */
const headingOf = (cell: Element): string => {
  const find = (node: ElementContent): string => node.type !== 'element' ? ''
    : node.tagName === 'img' ? String(node.properties?.alt ?? '') : node.children.map(find).find(Boolean) ?? '';
  const words = textOf(cell);
  return (filled(words) ? words : cell.children.map(find).find(Boolean) || '').replace(/\u00a0/g, ' ').trim();
};

/** Any span but exactly one — rowspan="0" stretches to the end of its group — breaks the column a label names. */
const spans = (cell: Element): boolean => [cell.properties?.colSpan, cell.properties?.rowSpan].some((value) => value !== undefined && Number(value) !== 1);

function rowsOf(table: Element): Element[] {
  const rows: Element[] = [];
  for (const child of table.children.filter(isElement)) {
    if (child.tagName === 'tr') rows.push(child);
    // One by one: spreading a long body into push() overflows the call stack.
    else if (['thead', 'tbody', 'tfoot'].includes(child.tagName)) {
      for (const row of child.children) if (isElement(row) && row.tagName === 'tr') rows.push(row);
    }
  }
  return rows;
}

const cellsOf = (row: Element): Element[] => row.children.filter(isElement).filter((cell) => cell.tagName === 'td' || cell.tagName === 'th');

function markTable(table: Element): void {
  const [head, ...body] = rowsOf(table);
  if (!head || !body.length) return;
  // Records only where the heading row is certain (a thead, or heading cells in the first row) and every cell sits
  // in its own column; any other table keeps its own scrolling box.
  const thead = table.children.find((child): child is Element => isElement(child) && child.tagName === 'thead');
  // One heading row exactly: a second one would be read as a record under the wrong headings.
  const headingRows = (rows: Element[]) => rows.filter((row) => cellsOf(row).length && cellsOf(row).every((cell) => cell.tagName === 'th')).length;
  const headed = (thead
    ? thead.children.filter(isElement).filter((row) => row.tagName === 'tr').length === 1
    : cellsOf(head).some((cell) => cell.tagName === 'th')) && headingRows(body) === 0;
  if (!headed || [head, ...body].some((row) => cellsOf(row).some(spans))) return;
  const headCells = cellsOf(head);
  const headings = headCells.map(headingOf);
  table.properties = { ...table.properties, dataRecords: '' };
  head.properties = { ...head.properties, dataRecordHead: '' };
  for (const row of body) {
    const cells = cellsOf(row);
    // The row's name is its first filled cell when that cell stands under no heading (the column of row names); a
    // filled cell under a named heading is a value, and keeps its heading.
    const first = cells.findIndex(holdsContent);
    const titleIndex = first >= 0 && !(headCells[first] && holdsContent(headCells[first])) ? first : -1;
    cells.forEach((cell, index) => {
      if (index === titleIndex) cell.properties = { ...cell.properties, dataRecordTitle: '' };
      else if (!holdsContent(cell)) cell.properties = { ...cell.properties, dataRecordEmpty: '' };
      else if (headings[index]) cell.properties = { ...cell.properties, dataRecordLabel: headings[index] };
    });
  }
}

/** Runs after the shared safe HTML pass: it adds attributes only, to tables already admitted. */
export function rehypeTableRecords() {
  return (tree: Root) => {
    const visit = (node: Root | ElementContent): void => {
      if (node.type === 'element' && node.tagName === 'table') markTable(node);
      if ('children' in node) (node.children as ElementContent[]).forEach(visit);
    };
    visit(tree);
  };
}
