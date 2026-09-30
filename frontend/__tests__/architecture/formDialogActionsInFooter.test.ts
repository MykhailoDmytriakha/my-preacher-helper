import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative } from 'path';

/**
 * A DIALOG'S SAVE AND CANCEL STAY ON SCREEN.
 *
 * `FormDialog` becomes three bands — a head that stays, a middle that scrolls, a foot that stays —
 * only when its actions are passed as `footer`. From 2026-09-07 twelve dialogs rendered
 * `<FormActions>` inside their children instead, so a long thought scrolled Save and Cancel off
 * the bottom of the window (owner, 2026-09-29: "the Save button was always visible before").
 * Every `<FormActions>` in a file that renders a `FormDialog` must therefore sit in its `footer`.
 */
const APP = join(__dirname, '..', '..', 'app');
const LOOK_BACK = 160;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === '__tests__' ? [] : sourceFiles(path);
    return path.endsWith('.tsx') ? [path] : [];
  });
}

/** Each `<FormActions` that is not written as the value of a `footer=` prop. */
function actionsOutsideFooter(source: string): number[] {
  const misplaced: number[] = [];
  for (let at = source.indexOf('<FormActions'); at !== -1; at = source.indexOf('<FormActions', at + 1)) {
    if (!source.slice(Math.max(0, at - LOOK_BACK), at).includes('footer=')) misplaced.push(source.slice(0, at).split('\n').length);
  }
  return misplaced;
}

describe('form dialogs keep their actions in the foot band', () => {
  it('passes every FormActions of a FormDialog as its footer', () => {
    const offenders = sourceFiles(APP)
      .filter(path => !path.endsWith(join('ui', 'FormDialog.tsx')))
      .map(path => ({ path, source: readFileSync(path, 'utf8') }))
      .filter(({ source }) => source.includes('<FormDialog') && source.includes('<FormActions'))
      .flatMap(({ path, source }) => actionsOutsideFooter(source).map(line => `${relative(APP, path)}:${line}`));
    expect(offenders).toEqual([]);
  });

  it('recognises actions placed in the body', () => {
    expect(actionsOutsideFooter('<FormDialog title="x">\n<div />\n<FormActions onCancel={close} />\n</FormDialog>')).toEqual([3]);
    expect(actionsOutsideFooter('<FormDialog footer={<FormActions onCancel={close} />}>')).toEqual([]);
    expect(actionsOutsideFooter('<FormDialog footer={editing ? <FormActions onCancel={close} /> : undefined}>')).toEqual([]);
  });
});
