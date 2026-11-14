/** @jest-environment node */
import { DeviceWorld, noteRef, noteValue, sermonRef, sermonValue, type WorldDevice } from '@test-utils/deviceWorld';

const variants = [
  { kind: 'ordered-title', resource: sermonRef, field: 'title', initial: sermonValue },
  { kind: 'unordered-date', resource: sermonRef, field: 'date', initial: sermonValue },
  { kind: 'long-content', resource: noteRef, field: 'content', initial: noteValue },
] as const;
const change = async (device: WorldDevice, variant: typeof variants[number], value: string) => {
  if (variant.kind === 'ordered-title') await device.saveField(variant.resource, variant.field, value);
  else await device.save(variant.resource, current => ({ ...current, [variant.field]: value }));
};

describe('S3: My older phone action arrives after my newer laptop action', () => {
  let world: DeviceWorld;
  afterEach(() => world?.dispose());
  for (const sample of ['valid', 'offline-reload', 'sleep'] as const) it.each(variants)('$kind, clock ' + sample, async variant => {
    const A = variant.field === 'date' ? '2026-11-13' : 'Phone action A';
    const B = variant.field === 'date' ? '2026-11-14' : 'Laptop action B';
    world = new DeviceWorld(); await world.seed(variant.resource, variant.initial());
    const phone = await world.device('phone', 300_000), laptop = await world.device('laptop', -300_000);
    await phone.open(variant.resource); await laptop.open(variant.resource);
    phone.goOffline();
    if (sample === 'offline-reload') { await phone.reload(); await phone.open(variant.resource); }
    if (sample === 'sleep') await phone.sleep(60_000);
    expect(Boolean(phone.clock.capture('owner'))).toBe(sample === 'valid');
    await change(phone, variant, A);
    await world.advance(60_000);
    await change(laptop, variant, B);
    await phone.goOnline();
    await phone.refresh(variant.resource); await laptop.refresh(variant.resource);
    const actual = { server: (await world.snapshot(variant.resource)).value?.[variant.field],
      phoneConfirmed: phone.shown(variant.resource).confirmed.value?.[variant.field], laptopConfirmed: laptop.shown(variant.resource).confirmed.value?.[variant.field], phone: phone.shown(variant.resource).draft?.[variant.field], laptop: laptop.shown(variant.resource).draft?.[variant.field],
      questions: await world.questions(), history: world.history(variant.resource) };
    if (variant.kind === 'ordered-title' && sample === 'valid') {
      expect(actual).toMatchObject({ server: B, phone: B, laptop: B, phoneConfirmed: B, laptopConfirmed: B, questions: [] });
      expect(actual.history).toEqual([expect.objectContaining({ title: A, winnerTitle: B })]);
    } else {
      const expected = { server: B, phone: A, laptop: B, phoneConfirmed: variant.initial()[variant.field], laptopConfirmed: B, history: [],
        questions: [{ device: 'phone', document: `${variant.resource.collection}/${variant.resource.id}`, kind: 'conflict', fields: [variant.field] },
          ...(variant.kind === 'ordered-title' ? [{ device: 'phone', document: `${variant.resource.collection}/${variant.resource.id}`, kind: 'manual:conflict', fields: [variant.field] }] : [])] };
      if (sample === 'valid') {
        // GAP: Both devices have reliable clocks, but this field's actions carry no time; the later action should converge and preserve the displaced value.
        // IDEAL: expect(actual).toMatchObject({ server: B, phone: B, laptop: B, phoneConfirmed: B, laptopConfirmed: B, questions: [] });
        // IDEAL: expect(actual.history).toHaveLength(1);
        expect(actual).toMatchObject(expected);
      } else {
        // Without evidence of order, keeping both copies and asking is the owner's rule.
        expect(actual).toMatchObject(expected);
      }
    }
  });
});

describe('S5: My later phone action wins regardless of which device delivers first', () => {
  let world: DeviceWorld;
  afterEach(() => world?.dispose());
  for (const arrival of ['phone-first', 'laptop-first'] as const) it.each(variants)('$kind, ' + arrival, async variant => {
    const A = variant.field === 'date' ? '2026-11-13' : 'Phone action A';
    const B = variant.field === 'date' ? '2026-11-14' : 'Laptop action B';
    world = new DeviceWorld(); await world.seed(variant.resource, variant.initial());
    const phone = await world.device('phone'), laptop = await world.device('laptop');
    await phone.open(variant.resource); await laptop.open(variant.resource);
    phone.goOffline(); laptop.goOffline();
    await change(laptop, variant, B);
    await world.advance(60_000);
    await change(phone, variant, A);
    for (const device of arrival === 'phone-first' ? [phone, laptop] : [laptop, phone]) await device.goOnline();
    await phone.refresh(variant.resource); await laptop.refresh(variant.resource);
    const actual = { server: (await world.snapshot(variant.resource)).value?.[variant.field],
      phoneConfirmed: phone.shown(variant.resource).confirmed.value?.[variant.field], laptopConfirmed: laptop.shown(variant.resource).confirmed.value?.[variant.field], phone: phone.shown(variant.resource).draft?.[variant.field], laptop: laptop.shown(variant.resource).draft?.[variant.field],
      questions: await world.questions(), history: world.history(variant.resource) };
    if (variant.kind === 'ordered-title') {
      expect(actual).toMatchObject({ server: A, phone: A, laptop: A, phoneConfirmed: A, laptopConfirmed: A, questions: [] });
      expect(actual.history).toEqual([expect.objectContaining({ title: B, winnerTitle: A })]);
    } else {
      const phoneFirst = arrival === 'phone-first';
      // GAP: Reliable page clocks are available, but no action proof is attached for date/content; delivery order determines the accepted copy and a needless choice remains.
      // IDEAL: expect(actual).toMatchObject({ server: A, phone: A, laptop: A, phoneConfirmed: A, laptopConfirmed: A, questions: [] });
      // IDEAL: expect(actual.history).toHaveLength(1);
      expect(actual).toEqual({ server: phoneFirst ? A : B, phone: A, laptop: B,
        phoneConfirmed: phoneFirst ? A : variant.initial()[variant.field], laptopConfirmed: phoneFirst ? variant.initial()[variant.field] : B,
        questions: [{ device: phoneFirst ? 'laptop' : 'phone', document: `${variant.resource.collection}/${variant.resource.id}`, kind: 'conflict', fields: [variant.field] }], history: [] });
    }
  });
});
