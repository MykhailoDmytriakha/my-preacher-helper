import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { isDeepStrictEqual as equal } from 'node:util';
export default async rt => {
  const {
      A,
      origin,
      owner,
      headers,
      caseName,
      build,
      ensure,
      scrub
    } = rt,
    width = rt.variant === 'narrow' ? 390 : 1280,
    id = 'qa-plan-typing-243-' + randomUUID(),
    resource = {
      collection: 'sermons',
      id
    },
    generation = randomUUID();
  const title = 'QA243 ordinary two-cell plan',
    nodes = ['p1', 's1'],
    baseline = {
      p1: 'QA243 original point paragraph',
      s1: 'QA243 original subpoint paragraph'
    },
    first = 'QA243 first rapid native text',
    second = 'QA243 second after reload native text';
  const r = {
    pass: false,
    qaComplete: false,
    checks: {},
    targets: {},
    screenshots: [],
    pageErrors: [],
    nativeInputs: [],
    browserCommands: [],
    fixtureCleanup: [],
    roundInputs: [],
    scope: 'Current compiled ordinary sermon-to-plan flow, two real editors, actual rapid native keyboard input, two canonical saves and reloads; no seeded drafts, mocked editor or fabricated response.'
  };
  let page,
    context,
    created = false,
    stage = 'fixture';
  const read = async () => {
    const res = await fetch(origin + '/api/data-engine/documents/sermons/' + id, {
      headers,
      cache: 'no-store'
    });
    ensure(res.status === 200, 'Owned canonical read refused');
    return res.json();
  };
  const send = async command => {
    ensure(command.owner === owner && command.resource.collection === 'sermons' && command.resource.id === id, 'Unowned synthetic command');
    const res = await fetch(origin + '/api/data-engine/commands', {
      method: 'POST',
      headers: {
        ...headers,
        'content-type': 'application/json'
      },
      body: JSON.stringify(command)
    });
    const answer = await res.json();
    ensure(res.status === 200 && answer.kind === 'acknowledged', 'Fixture command refused');
    return answer;
  };
  const shot = async label => {
    const file = path.join(A, caseName + '-' + label + '.png');
    try {
      await fs.access(file);
      throw Error('Screenshot exists');
    } catch (e) {
      if (e.code !== 'ENOENT') throw e;
    }
    await page.screenshot({
      path: file,
      animations: 'disabled'
    });
    r.screenshots.push({
      label,
      file
    });
  };
  const poll = async (fn, label) => {
    for (let i = 0; i < 150; i++) {
      if (await fn()) return;
      await page.waitForTimeout(100);
    }
    throw Error('Timed out: ' + label);
  };
  const tap = async locator => {
    await locator.waitFor({
      state: 'visible'
    });
    if ((await locator.getAttribute('disabled')) !== null) throw Error('Native target disabled');
    await locator.scrollIntoViewIfNeeded();
    const a = await locator.boundingBox();
    await page.waitForTimeout(100);
    const b = await locator.boundingBox();
    ensure(a && b && equal(a, b), 'Moving native target');
    const p = {
      x: b.x + Math.min(b.width / 2, 80),
      y: b.y + b.height / 2
    };
    ensure(await locator.evaluate((el, p) => {
      const hit = document.elementFromPoint(p.x, p.y);
      return hit === el || el.contains(hit);
    }, p), 'Native target covered');
    await page.mouse.click(p.x, p.y);
  };
  const errors = () => r.pageErrors.some(e => /#185|Maximum update depth/i.test(e.message));
  try {
    ensure((await read()).value === null, 'Fixture already exists');
    const stamp = new Date().toISOString(),
      outline = {
        introduction: [],
        main: [{
          id: 'p1',
          text: 'QA243 Main point',
          subPoints: [{
            id: 's1',
            text: 'QA243 Sub point',
            position: 0
          }]
        }],
        conclusion: []
      };
    await send({
      protocol: 1,
      operationId: generation,
      owner,
      resource,
      generation: null,
      dependsOn: [],
      kind: 'create',
      value: {
        userId: owner,
        title,
        verse: 'John 3:16',
        date: stamp,
        thoughts: [],
        outline,
        planMode: 'ai',
        planText: baseline,
        createdAt: stamp,
        updatedAt: stamp
      }
    });
    created = true;
    r.seed = await read();
    ensure(equal(r.seed.value.planText, baseline), 'Canonical fixture differs');
    r.checks.ownedCanonicalTwoCellFixture = true;
    context = await rt.createContext(width, 1000, 'en');
    page = await context.newPage();
    await page.setViewportSize({
      width,
      height: 1000
    });
    page.setDefaultTimeout(20000);
    page.on('pageerror', e => r.pageErrors.push({
      message: scrub(e.message),
      stack: scrub(e.stack)
    }));
    page.on('request', request => {
      if (new URL(request.url()).origin === origin && new URL(request.url()).pathname === '/api/data-engine/commands' && request.method() === 'POST') {
        const command = request.postDataJSON();
        if (command.resource?.id === id) r.browserCommands.push(command);
      }
    });
    await page.addInitScript(() => {
      window.__qa243Input = [];
      addEventListener('input', event => {
        const editor = event.target?.closest?.('.ProseMirror');
        if (editor) window.__qa243Input.push({
          trusted: event.isTrusted,
          text: editor.innerText,
          at: Date.now()
        });
      }, true);
    });
    const opening = await page.goto(origin + '/sermons/' + id, {
      waitUntil: 'domcontentloaded'
    });
    ensure(opening.status() === 200 && (await opening.text()).includes(build), 'Wrong compiled build');
    await page.getByRole('heading', {
      level: 1,
      name: title,
      exact: true
    }).waitFor();
    const dict = JSON.parse(await fs.readFile(new URL('../locales/en/translation.json', import.meta.url), 'utf8'));
    await tap(page.getByRole('button', {
      name: dict.plan.pageTitle,
      exact: true
    }));
    await page.waitForURL('**/sermons/' + id + '/plan');
    r.checks.actualSermonToPlanNavigation = true;
    const editors = page.locator('.ProseMirror'),
      edit = async () => {
        if ((await editors.count()) === 0) await tap(page.getByTitle(dict.plan.editMode, {
          exact: true
        }));
        await poll(async () => (await editors.count()) === 2, 'two actual point/subpoint editors');
      };
    const typeBoth = async phrase => {
      await edit();
      for (let i = 0; i < 2; i++) {
        await tap(editors.nth(i));
        await page.keyboard.press('Meta+ArrowDown');
        await page.keyboard.type(' ' + phrase, {
          delay: 0
        });
        await page.waitForTimeout(400);
        r.nativeInputs = await page.evaluate(() => window.__qa243Input);
        if (errors()) return false;
      }
      r.roundInputs.push({
        stage,
        events: [...r.nativeInputs]
      });
      return true;
    };
    const save = async label => {
      const answer = page.waitForResponse(res => {
        if (new URL(res.url()).origin !== origin || new URL(res.url()).pathname !== '/api/data-engine/commands' || res.request().method() !== 'POST') return false;
        try {
          return res.request().postDataJSON().resource?.id === id;
        } catch {
          return false;
        }
      }, {
        timeout: 30000
      });
      void answer.catch(() => undefined);
      await tap(page.getByTitle(dict.plan.save, {
        exact: true
      }));
      const response = await answer,
        body = await response.json();
      ensure(response.status() === 200 && body.kind === 'acknowledged', 'Actual native Save not acknowledged');
      r[label] = {
        command: response.request().postDataJSON(),
        answer: body
      };
    };
    stage = 'first native typing';
    await edit();
    r.checks.actualTwoCellEditors = true;
    await shot('original-two-editors');
    const firstTyped = await typeBoth(first);
    r.checks.trustedNativeInput = r.nativeInputs.some(e => e.trusted && e.text.includes('QA243'));
    if (!firstTyped) {
      r.targets.noReactUpdateLoop = false;
      r.qaComplete = Object.values(r.checks).every(Boolean);
      await shot('react-update-loop');
      return r;
    }
    await poll(async () => (await editors.nth(0).innerText()).includes(first) && (await editors.nth(1).innerText()).includes(first), 'first native letters visible');
    r.targets.firstNativeCellsRetained = true;
    stage = 'first real Save';
    await save('firstSave');
    r.firstSaved = await read();
    ensure(nodes.every(n => r.firstSaved.value.planText[n] === baseline[n] + ' ' + first) && equal(r.firstSaved.value.outline, outline), 'First canonical save changed or lost cell words');
    r.targets.firstSaveAcceptedBothCells = true;
    stage = 'reload after first Save';
    await page.reload({
      waitUntil: 'domcontentloaded'
    });
    await poll(async () => page.evaluate(({
      baseline,
      first
    }) => Object.values(baseline).every(t => document.body.innerText.includes(t + ' ' + first)), {
      baseline,
      first
    }), 'first saved cells after reload');
    await page.waitForTimeout(500);
    await shot('first-saved-reload');
    stage = 'second native typing after reload';
    if (!(await typeBoth(second))) {
      r.targets.noReactUpdateLoop = false;
      r.qaComplete = Object.values(r.checks).every(Boolean);
      await shot('react-update-loop-after-reload');
      return r;
    }
    stage = 'second real Save';
    await save('secondSave');
    r.secondSaved = await read();
    ensure(nodes.every(n => r.secondSaved.value.planText[n] === baseline[n] + ' ' + first + ' ' + second) && equal(r.secondSaved.value.outline, outline), 'Second canonical save changed or lost cell words');
    stage = 'final saved reload';
    await page.reload({
      waitUntil: 'domcontentloaded'
    });
    await poll(async () => page.evaluate(({
      baseline,
      first,
      second
    }) => Object.values(baseline).every(t => document.body.innerText.includes(t + ' ' + first + ' ' + second)), {
      baseline,
      first,
      second
    }), 'both accepted cell versions after final reload');
    await page.waitForTimeout(500);
    await shot('second-saved-reload');
    r.targets.noReactUpdateLoop = !errors();
    r.targets.secondSaveAndReloadRetainBothCells = true;
    r.targets.noPageErrors = r.pageErrors.length === 0;
    r.qaComplete = Object.values(r.checks).every(Boolean);
    r.pass = r.qaComplete && Object.values(r.targets).every(Boolean);
  } catch (e) {
    r.failure = {
      stage,
      message: scrub(e.message)
    };
    if (page) r.nativeInputs = await page.evaluate(() => window.__qa243Input || []).catch(() => []);
    if (errors() && r.nativeInputs.some(x => x.trusted)) {
      r.checks.trustedNativeInput = true;
      r.targets.noReactUpdateLoop = false;
      r.qaComplete = Object.values(r.checks).every(Boolean);
    }
    if (page) await shot('failure').catch(() => {});
  } finally {
    if (page) {
      r.finalWindowNativeInputs = await page.evaluate(() => window.__qa243Input || []).catch(() => []);
      if (r.finalWindowNativeInputs.length) r.nativeInputs = r.finalWindowNativeInputs;
      await page.close().catch(() => {});
    }
    if (created) try {
      const current = await read();
      ensure(current.value.userId === owner && current.value.title === title && current.metadata.generation === generation, 'Unowned synthetic cleanup');
      await send({
        protocol: 1,
        operationId: randomUUID(),
        owner,
        resource,
        generation,
        dependsOn: [],
        kind: 'delete',
        baseline: current.value
      });
      const gone = await read();
      ensure(gone.value === null && gone.metadata.deleted, 'Fixture not tombstoned');
      r.fixtureCleanup.push({
        id,
        deleted: true
      });
    } catch (e) {
      r.cleanupFailure = scrub(e.message);
      r.pass = false;
    }
  }
  return r;
};
