/** @jest-environment node */
import { DeviceWorld, sermonRef, sermonValue } from '@test-utils/deviceWorld';
import { request } from '@test-utils/checkpointFixtures';

import { initializeCommit } from '../../atomicCommits';
import { committedSermonText, sermonTextKey } from '../../sermonTextOpenings';

import { readSermonNoteText, withSermonNoteText } from '@/utils/sermonNoteText';

import type { CommitRequest } from '../../commits';
import type { DataCommand, DocumentData } from '../../types';
import type { SermonNoteTarget } from '@/utils/sermonNoteText';

const target: SermonNoteTarget = { kind: 'point', id: 'point' };
const opening = 'Opening words kept on purpose';
const earlier = 'Earlier words written offline';
const later = 'Later words written at the desk';
const unchanged = 'Keep the other cell exact';
const sermon = { ...sermonValue(), outline: { introduction: [], main: [{ id: 'point', text: 'A point', note: opening },
  { id: 'other', text: 'Another point', note: unchanged }], conclusion: [] }, planText: { point: opening, other: unchanged } };

const planWith = (words: string, other = unchanged): DocumentData => ({ point: words, other });
const planEdit = (words: string) => (value: DocumentData): DocumentData => ({ ...value, planText: planWith(words) });
const planOpening = sermonTextKey('planText', 'point');

describe('A delayed sermon text after a deliberate return', () => {
  let world: DeviceWorld;
  afterEach(() => world?.dispose());

  it.each(['cell', 'reminder'] as const)('compares a delayed %s without replacing the deliberate return', async field => {
    world = new DeviceWorld();
    const change = (text: string) => (value: DocumentData) => field === 'cell'
      ? { ...value, planText: { ...(value.planText as DocumentData), point: text } }
      : withSermonNoteText(value, target, text)!;
    const text = (value: DocumentData | null) => field === 'cell'
      ? (value?.planText as DocumentData | undefined)?.point : readSermonNoteText(value, target)?.text;
    await world.seed(sermonRef, sermon);
    const phone = await world.device('phone'), desktop = await world.device('desktop');
    await phone.open(sermonRef);
    await desktop.open(sermonRef);
    phone.goOffline();
    await phone.save(sermonRef, change(earlier));
    await world.advance(60_000);
    await desktop.save(sermonRef, change(later));
    expect(text((await world.snapshot(sermonRef)).value)).toBe(later);
    await desktop.save(sermonRef, change(opening));
    expect(text((await world.snapshot(sermonRef)).value)).toBe(opening);
    await phone.goOnline();
    expect(text((await world.snapshot(sermonRef)).value)).toBe(opening);
    expect(text(phone.shown(sermonRef).draft)).toBe(earlier);
    expect(await world.questions()).toEqual([expect.objectContaining({ device: 'phone', kind: 'conflict', document: 'sermons/sermon-x',
      fields: [field === 'cell' ? 'planText.point' : 'outline.main.id:point.note'] })]);
  });
  it('accepts two explicit saves for the same cell from one offline opening', async () => {
    world = new DeviceWorld();
    await world.seed(sermonRef, sermon);
    const phone = await world.device('phone');
    const editor = await phone.open(sermonRef);
    phone.goOffline();
    const action = { kind: 'sermon-plan-text' as const, openings: { point: 1 } };
    await phone.run(() => editor.commit(value => planEdit(later)(value!), action));
    await phone.run(() => editor.commit(value => planEdit(opening)(value!), action));
    await world.settle();
    await phone.goOnline();
    expect((await world.snapshot(sermonRef)).value?.planText).toEqual(planWith(opening));
    expect((await world.snapshot(sermonRef)).metadata?.revision).toBe(3);
    expect(await world.questions()).toEqual([]);
  });

  it('preserves an independently saved cell when the other cell is being compared', async () => {
    world = new DeviceWorld();
    await world.seed(sermonRef, sermon);
    const phone = await world.device('phone'), desktop = await world.device('desktop');
    const editor = await phone.open(sermonRef);
    await desktop.open(sermonRef);
    phone.goOffline();
    await phone.save(sermonRef, value => ({ ...value, planText: planWith(earlier, 'Independent phone words') }));
    await desktop.save(sermonRef, planEdit(later));
    await desktop.save(sermonRef, planEdit(opening));
    await phone.goOnline();
    expect((await world.snapshot(sermonRef)).value?.planText).toEqual(planWith(opening));
    await phone.run(() => editor.acceptRemote(undefined, editor.getState().checkpoint));
    await world.settle();
    expect((await world.snapshot(sermonRef)).value?.planText).toEqual(planWith(opening, 'Independent phone words'));
    expect(await world.questions()).toEqual([]);
  });

  it('detects the return of a reminder after its row was removed and restored', async () => {
    world = new DeviceWorld();
    await world.seed(sermonRef, sermon);
    const phone = await world.device('phone'), desktop = await world.device('desktop');
    await phone.open(sermonRef);
    await desktop.open(sermonRef);
    phone.goOffline();
    await phone.save(sermonRef, value => withSermonNoteText(value, target, earlier)!);
    await desktop.save(sermonRef, value => ({ ...value, outline: { ...sermon.outline, main: [sermon.outline.main[1]] } }));
    await desktop.save(sermonRef, value => ({ ...value, outline: sermon.outline }));
    await phone.goOnline();
    expect(readSermonNoteText((await world.snapshot(sermonRef)).value, target)?.text).toBe(opening);
    expect(await world.questions()).toEqual([expect.objectContaining({ device: 'phone', kind: 'conflict',
      fields: ['outline.main.id:point.note'] })]);
  });

  it('keeps a fresh observation and only raises the exact proven predecessor leaf for queued saves', () => {
    const metadata = { protocol: 1 as const, generation: 'sermon-generation', revision: 1, deleted: false };
    const baseline = { resource: sermonRef, value: sermon, metadata };
    const value = { ...sermon, planText: planWith(later, 'The other cell, already shown') };
    const committed = { ...metadata, revision: 2, operationId: 'prior' };
    const head = { ...baseline, value, metadata: { ...metadata, revision: 4, operationId: 'newer' } };
    const command: DataCommand = { protocol: 1, kind: 'update', resource: sermonRef, owner: 'owner',
      operationId: 'prior', generation: metadata.generation, dependsOn: [],
      changes: [{ path: ['planText'], before: { exists: true, value: planWith(opening) },
        after: { exists: true, value: planWith(later) } }], sermonTextObservedRevision: 1 };
    const reply = { kind: 'acknowledged' as const, operationId: 'prior', snapshot: head, committed };
    const prior: CommitRequest = { ...request('prior'), editorId: 'editor', baseline, working: head, value, intended: value,
      command: null, state: 'acknowledged', result: reply, committedSermonText: committedSermonText(command, reply) };
    const laterDraft = { ...sermon, planText: planWith(earlier, unchanged) };
    const successor: CommitRequest = { ...request('later'), editorId: 'editor', baseline, working: baseline,
      value: laterDraft, intended: laterDraft, predecessor: 'prior', initialized: false };
    expect(initializeCommit(successor, [prior, successor])).toMatchObject({
      sermonTextPredecessorRevision: 1, sermonTextContinuation: { [planOpening]: 2 },
    });
    const fresh = { ...successor, baseline: head };
    const initialized = initializeCommit(fresh, [prior, fresh]);
    expect(initialized?.sermonTextPredecessorRevision).toBe(4);
    expect(initialized?.sermonTextContinuation).toBeUndefined();
    const coalesced = { ...reply, committed: { ...committed, revision: 3 } };
    expect(committedSermonText(command, coalesced)).toBeUndefined();
  });
});
