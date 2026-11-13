/** @jest-environment node */
import { DeviceWorld, noteRef, noteValue } from '@test-utils/deviceWorld';

describe('S4: I edit paragraphs on two offline devices', () => {
  let world: DeviceWorld;
  afterEach(() => world?.dispose());
  for (const overlap of ['different', 'same'] as const) it.each(['phone-first', 'laptop-first'])('paragraphs ' + overlap + ', %s', async arrival => {
    world = new DeviceWorld(); await world.seed(noteRef, noteValue());
    const phone = await world.device('phone'), laptop = await world.device('laptop');
    await phone.open(noteRef); await laptop.open(noteRef); phone.goOffline(); laptop.goOffline();
    const phoneText = 'My phone paragraph.\n\nSecond paragraph.';
    const laptopText = overlap === 'different' ? 'First paragraph.\n\nMy laptop paragraph.' : 'My laptop paragraph.\n\nSecond paragraph.';
    await phone.update(noteRef, current => ({ ...current, content: phoneText })); await world.advance(750);
    await laptop.update(noteRef, current => ({ ...current, content: laptopText })); await world.advance(750);
    for (const device of arrival === 'phone-first' ? [phone, laptop] : [laptop, phone]) await device.goOnline();
    await phone.refresh(noteRef); await laptop.refresh(noteRef);
    const actual = { server: (await world.snapshot(noteRef)).value?.content, phone: phone.shown(noteRef).draft?.content, laptop: laptop.shown(noteRef).draft?.content, questions: await world.questions() };
    const expected = { server: arrival === 'phone-first' ? phoneText : laptopText, phone: phoneText, laptop: laptopText,
      questions: [{ device: arrival === 'phone-first' ? 'laptop' : 'phone', document: 'studyNotes/note-x', kind: 'conflict', fields: ['content'] }] };
    if (overlap === 'different') {
      // GAP: Complementary paragraph changes should compose without a question; today the entire string is one conflicting value.
      // IDEAL: expect(actual).toEqual({ server: 'My phone paragraph.\n\nMy laptop paragraph.', phone: 'My phone paragraph.\n\nMy laptop paragraph.', laptop: 'My phone paragraph.\n\nMy laptop paragraph.', questions: [] });
      expect(actual).toEqual(expected);
    } else {
      // These edits overlap and no text-action order was captured: preserve both and ask.
      expect(actual).toEqual(expected);
    }
    expect(world.history(noteRef)).toEqual([]);
  });
});
