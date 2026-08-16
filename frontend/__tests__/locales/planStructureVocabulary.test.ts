import en from '@locales/en/translation.json';
import ru from '@locales/ru/translation.json';
import uk from '@locales/uk/translation.json';

/**
 * ONE WORD, ONE ARTEFACT — HELD AGAINST THE REAL LOCALE FILES.
 *
 * The product carries three things the word "plan" used to name at once, and they are now
 * told apart on screen:
 *
 *   План      — the document a preacher reads from (`sermon.plan`)
 *   Структура — the skeleton of points and sub-points (`sermon.outline`)
 *   Тариф     — the billing tier
 *
 * Tests that mock `t` to return the key, or that carry their own dictionary, cannot notice
 * when the actual files drift back. These assertions read the shipped JSON.
 */

type Bag = Record<string, unknown>;

const read = (bundle: Bag, dotted: string): string | undefined => {
  const value = dotted.split('.').reduce<unknown>(
    (node, part) => (node && typeof node === 'object' ? (node as Bag)[part] : undefined),
    bundle
  );
  return typeof value === 'string' ? value : undefined;
};

const locales: Array<[string, Bag]> = [['en', en as Bag], ['ru', ru as Bag], ['uk', uk as Bag]];

describe('plan / structure vocabulary', () => {
  /** Keys naming the SKELETON. None of them may call it a plan in any language. */
  const structureKeys = [
    'sermon.outline.title',
    'planEditor.title',
    'planEditor.clear',
    'planEditor.apply.replace',
    'planEditor.apply.append',
    'planTemplates.description',
    'errors.saveOutlineError',
    'errors.fetchOutlineError',
    'errors.outlinePointNotFound',
    'plan.noThoughtsAssigned',
    'scratch.board.title',
    'scratch.board.apply',
    'scratch.applyGuard.replace',
  ];

  it.each(locales)('never calls the structure a plan in %s', (name, bundle) => {
    structureKeys.forEach((key) => {
      const value = read(bundle, key);
      expect(value).toBeDefined();
      const saysPlan = name === 'en' ? /\bplan\b/i : /план|плану|плана|планом/i;
      expect({ key, value }).toEqual({ key, value: expect.not.stringMatching(saysPlan) });
    });
  });

  it.each(locales)('names the structure explicitly in %s', (name, bundle) => {
    const saysStructure = name === 'en' ? /structure/i : /структур/i;
    structureKeys.forEach((key) => {
      expect({ key, value: read(bundle, key) })
        .toEqual({ key, value: expect.stringMatching(saysStructure) });
    });
  });

  it('keeps the hand-written route labelled in every language', () => {
    // Without this entry the trail read "… / План / Manual" — an English word nobody wrote.
    expect(read(en as Bag, 'navigation.breadcrumb.manual')).toBe('By hand');
    expect(read(ru as Bag, 'navigation.breadcrumb.manual')).toBe('Вручную');
    expect(read(uk as Bag, 'navigation.breadcrumb.manual')).toBe('Вручну');
  });

  it('leaves the exegetical plan alone — it is a homiletics term, not this app`s structure', () => {
    // "План отрывка" is the passage's own outline, taught in the wizard. A sweep once
    // rewrote it and the lesson began contradicting its own definition a line above.
    const key = 'wizard.steps.exegeticalPlan.simpleStudy.requirementsIntro';
    expect(read(en as Bag, key)).toContain('plan');
    expect(read(ru as Bag, key)).toContain('план');
    expect(read(uk as Bag, key)).toContain('план');
  });

  it('calls the billing tier a тариф, so it cannot be read as the document', () => {
    ['usageGrace.tooltipTitle', 'settings.usage.title'].forEach((key) => {
      expect(read(ru as Bag, key)).toMatch(/тариф/i);
      expect(read(uk as Bag, key)).toMatch(/тариф/i);
    });
  });

  it('names the AI suggestion as its own artefact, neither plan nor structure', () => {
    // It reads and writes `insights.sectionHints` — a third thing that had no name of its own.
    expect(read(ru as Bag, 'knowledge.suggestedPlan')).toBe('Вариант плана');
    expect(read(uk as Bag, 'knowledge.suggestedPlan')).toBe('Варіант плану');
    expect(read(en as Bag, 'knowledge.suggestedPlan')).toBe('Plan suggestion');
  });

  it('has no user-facing key left untranslated in uk', () => {
    // The whole `errors` block sat in English while the rest of the app spoke Ukrainian.
    const errors = (uk as Bag).errors as Record<string, string>;
    const englishLooking = Object.entries(errors)
      .filter(([, value]) => typeof value === 'string' && /^[A-Za-z][A-Za-z\s.,'"-]+$/.test(value))
      .map(([key]) => key);
    expect(englishLooking).toEqual([]);
  });
});
