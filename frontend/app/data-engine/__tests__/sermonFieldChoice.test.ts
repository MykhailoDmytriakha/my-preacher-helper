import { moveSubPoint } from '@/utils/outlineDnd';

import { projectExactManualChoice, projectSavedChoiceDependents, recoverManualChoiceCopy } from '../manualChoice';
import { manualComparison } from '../manualComparison';
import { projectOutlineParentChoice, readOutlineParentComparison } from '../outlineParentChoice';
import { replaceResourceOutline } from '../outlinePlacementResource';
import { preachDateReviewConflicts } from '../preachDateChoice';
import { mergeDocumentFields } from '../protocol';
import { validateRecoveryRecord } from '../recovery.client';
import { keepUncontestedSermonFields, readSermonPlanModeComparison } from '../sermonFieldChoice';
import { DataSession, type SessionCheckpoint } from '../session';

import type { CommitRequest } from '../commits';
import type { ManualScope } from '../manualScope';
import type { DocumentData, ResourceSnapshot } from '../types';
import type { SermonOutline } from '@/models/models';

it.each(['same words', 'replaced date', 'removed date'])('can accept stored preaching notes after the server has %s', scenario => {
  const row = { id: 'date', createdAt: 'original date', notes: 'Opening words', audience: 'Opening audience' };
  const mine = { ...row, notes: 'My words', audience: 'My audience' };
  const value: DocumentData = { preachDates: [row], verse: 'Opening verse' };
  const basis: ResourceSnapshot = { resource: { collection: 'sermons', id: 'sermon' }, value,
    metadata: { protocol: 1, generation: 'original', revision: 1, deleted: false } };
  const replacement = { ...row, createdAt: 'replacement date', notes: 'Other date words' };
  const liveRows = scenario === 'same words' ? [{ ...row, notes: mine.notes }] : scenario === 'replaced date' ? [replacement] : [];
  const stored: ResourceSnapshot = { ...basis, value: { ...value, preachDates: liveRows },
    metadata: { ...basis.metadata!, revision: 4 } };
  const draft = { ...value, preachDates: [mine], verse: 'Independent edit' };
  const conflicts = [{ path: ['preachDates', 'id:date', 'notes'],
    base: { exists: true, value: row.notes }, mine: { exists: true, value: mine.notes },
    theirs: { exists: true, value: 'Previously compared words' } }];

  expect(keepUncontestedSermonFields(basis, draft, stored, conflicts)).toEqual({
    preachDates: scenario === 'same words' ? [mine] : liveRows, verse: 'Independent edit',
  });
});

it.each([
  ['preach-date-note-settled', 'local'], ['preach-date-note-settled', 'remote'],
  ['preach-date-note-queued', 'local'], ['preach-date-note-queued', 'remote'],
] as const)('keeps the %s note when a manual Save chooses %s audience', (noteResult, choice) => {
  const row = { id: 'date', createdAt: 'original date', notes: 'Opening notes', audience: 'Opening audience' };
  const phone = { ...row, notes: 'Phone notes', audience: 'Phone audience' };
  const laptop = { ...row, audience: 'Laptop audience' };
  const value: DocumentData = { preachDates: [row] };
  const draft: DocumentData = { preachDates: [phone] };
  const basis: ResourceSnapshot = { resource: { collection: 'sermons', id: 'sermon' }, value,
    metadata: { protocol: 1, generation: 'original', revision: 1, deleted: false } };
  const stored: ResourceSnapshot = { ...basis, value: { preachDates: [laptop] },
    metadata: { ...basis.metadata!, revision: 3 } };
  const field = (value: string) => ({ exists: true, value });
  const conflicts = [
    { path: ['preachDates', 'id:date', 'audience'], base: field(row.audience), mine: field(phone.audience), theirs: field(laptop.audience) },
    { path: ['preachDates', 'id:date', 'notes'], code: noteResult, base: field(row.notes), mine: field(phone.notes), theirs: field(laptop.notes) },
  ];
  const time = { earliestMs: 1_800_000_000_080, latestMs: 1_800_000_000_085 };
  const action = { rowId: row.id, rowCreatedAt: row.createdAt, before: row.notes, after: phone.notes, observedRevision: 1, time };
  const request: CommitRequest = { id: 'date-save', owner: 'owner', editorId: 'date-form', editGeneration: 1, predecessor: null,
    preachDateFieldActions: { notes: action },
    baseline: basis, value: draft, revision: 1, initialized: true, working: basis, intended: draft, command: null, submitted: draft,
    sequence: 0, state: 'conflict', unfinalized: [],
    result: { kind: 'conflict', operationId: 'date-save', snapshot: stored, conflicts } };
  const checkpoint: SessionCheckpoint = { confirmed: basis, draft, remoteCandidate: stored, conflicts, dirty: true,
    editGeneration: 1, pending: { [request.id]: { generation: 1, value: draft } } };

  const exact = projectExactManualChoice({ owner: 'owner', editorId: 'document', checkpoint, prepared: null, unfinalized: [] },
    { choice, request, value: draft, stored, selection: [['preachDates'], ['isPreached']] }, [request])[0].checkpoint;
  expect(exact.draft?.preachDates).toEqual([{ ...row, audience: choice === 'local' ? phone.audience : laptop.audience,
    notes: noteResult === 'preach-date-note-queued' ? phone.notes : laptop.notes }]);
  expect(exact.preachDateNotesDrafts?.[row.id]?.action).toEqual(noteResult === 'preach-date-note-queued' ? action : undefined);

  const noteOnly = { ...request, result: { ...request.result!, kind: 'conflict' as const, snapshot: stored, conflicts: [
    { ...conflicts[1], code: undefined },
  ] } };
  const choiceTime = { earliestMs: 1_800_000_000_180, latestMs: 1_800_000_000_185 };
  const chosen = projectExactManualChoice({ owner: 'owner', editorId: 'document', checkpoint, prepared: null, unfinalized: [] },
    { choice: 'local', request: noteOnly, value: draft, stored, selection: [['preachDates']], choiceTime }, [noteOnly])[0].checkpoint;
  expect(chosen.preachDateNotesDrafts?.[row.id]?.action).toMatchObject({ time: choiceTime, observedRevision: 3, after: phone.notes });
});

it.each([
  ['preach-date-detail-settled', 'local'], ['preach-date-detail-settled', 'remote'],
  ['preach-date-detail-queued', 'local'], ['preach-date-detail-queued', 'remote'],
] as const)('preserves the %s audience during a %s choice about notes', (audienceResult, choice) => {
  const row = { id: 'date', createdAt: 'birth', notes: 'Opening notes', audience: 'Youth' };
  const phone = { ...row, notes: 'Phone notes', audience: 'Leaders' };
  const desktop = { ...row, notes: 'Desktop notes' };
  const basis: ResourceSnapshot = { resource: { collection: 'sermons', id: 'sermon' }, value: { preachDates: [row] },
    metadata: { protocol: 1, generation: 'original', revision: 1, deleted: false } };
  const draft = { preachDates: [phone] };
  const stored: ResourceSnapshot = { ...basis, value: { preachDates: [desktop] }, metadata: { ...basis.metadata!, revision: 3 } };
  const field = (value: string) => ({ exists: true, value });
  const conflicts = [
    { path: ['preachDates', 'id:date', 'audience'], code: audienceResult, base: field(row.audience), mine: field(phone.audience), theirs: field(desktop.audience) },
    { path: ['preachDates', 'id:date', 'notes'], base: field(row.notes), mine: field(phone.notes), theirs: field(desktop.notes) },
  ];
  const action = { rowId: row.id, rowCreatedAt: row.createdAt, before: row.audience, after: phone.audience, observedRevision: 1,
    time: { earliestMs: 1_800_000_000_080, latestMs: 1_800_000_000_085 } };
  const request: CommitRequest = { id: 'date-save', owner: 'owner', editorId: 'date-form', editGeneration: 1, predecessor: null,
    preachDateFieldActions: { audience: action }, baseline: basis, value: draft, revision: 1, initialized: true, working: basis,
    intended: draft, command: null, submitted: draft, sequence: 0, state: 'conflict', unfinalized: [],
    result: { kind: 'conflict', operationId: 'date-save', snapshot: stored, conflicts } };
  const checkpoint: SessionCheckpoint = { confirmed: basis, draft, remoteCandidate: stored, conflicts, dirty: true,
    editGeneration: 1, pending: { [request.id]: { generation: 1, value: draft } } };
  const [resolved] = projectExactManualChoice({ owner: 'owner', editorId: 'document', checkpoint, prepared: null, unfinalized: [] },
    { choice, request, value: draft, stored, selection: [['preachDates']] }, [request]);
  const queued = audienceResult === 'preach-date-detail-queued';
  expect(resolved.checkpoint.draft?.preachDates).toEqual([{ ...row, notes: choice === 'local' ? phone.notes : desktop.notes,
    audience: queued ? phone.audience : desktop.audience }]);
  expect(resolved.checkpoint.preachDateAudienceDrafts?.[row.id]?.action).toEqual(queued ? action : undefined);
  expect(preachDateReviewConflicts(basis.value, draft, stored.value, conflicts).map(({ path }) => path.at(-1))).toEqual(['notes']);
});

it.each(['changed the date', 'replaced the row', 'removed the row'])(
  'keeps the remote choice usable when the stored copy has %s since the audience conflict', change => {
    const row = { id: 'date', createdAt: 'opened date', date: '2026-11-20', notes: 'Opening notes', audience: 'Opening audience' };
    const other = { ...row, id: 'other' };
    const phone = { ...row, date: '2026-11-23', notes: 'Ordered phone notes', audience: 'Phone audience' };
    const laptop = { ...row, audience: 'Laptop audience' };
    const latest = change === 'changed the date' ? { ...laptop, date: '2026-11-25' }
      : change === 'replaced the row' ? { ...laptop, createdAt: 'replaced date', notes: 'Replacement words' } : null;
    const basis: ResourceSnapshot = { resource: { collection: 'sermons', id: 'sermon' },
      value: { preachDates: [row, other] }, metadata: { protocol: 1, generation: 'g', revision: 1, deleted: false } };
    const stored: ResourceSnapshot = { ...basis, value: { preachDates: latest ? [latest, other] : [other] },
      metadata: { ...basis.metadata!, revision: 4 } };
    const independent = { ...other, notes: 'Independent notes on another date' };
    const draft = { preachDates: [phone, independent] };
    const field = (value: string) => ({ exists: true, value });
    const originalConflicts = [
      { path: ['preachDates', 'id:date', 'audience'], base: field(row.audience), mine: field(phone.audience), theirs: field(laptop.audience) },
      { path: ['preachDates', 'id:date', 'notes'], code: 'preach-date-note-queued', base: field(row.notes), mine: field(phone.notes), theirs: field(laptop.notes) },
    ];
    if (change === 'changed the date') {
      const paths = preachDateReviewConflicts(basis.value, draft, stored.value, originalConflicts).map(({ path }) => path);
      expect(paths).toEqual([['preachDates', 'id:date', 'audience'], ['preachDates', 'id:date', 'date']]);
      const converged = { ...stored.value, preachDates: [{ ...latest, audience: phone.audience }, other] };
      expect(preachDateReviewConflicts(basis.value, draft, converged, originalConflicts).map(({ path }) => path))
        .toEqual([['preachDates', 'id:date', 'date']]);
    }
    const projected = keepUncontestedSermonFields(basis, draft, stored, originalConflicts);
    const expected = change === 'changed the date' ? [{ ...latest, notes: phone.notes }, independent]
      : latest ? [latest, independent] : [independent];
    expect(projected?.preachDates).toEqual(expected);
  });

it('accepts several shown preaching date fields and keeps unrelated authored edits', () => {
  const row = { id: 'date', date: '2026-11-20', createdAt: 'original', notes: 'Opening notes', audience: 'Opening audience' };
  const basis: ResourceSnapshot = { resource: { collection: 'sermons', id: 'sermon' },
    value: { preachDates: [row] }, metadata: { protocol: 1, generation: 'g', revision: 1, deleted: false } };
  const phone = { ...row, date: '2026-11-21', notes: 'Phone notes', audience: 'Phone audience' };
  const laptop = { ...row, notes: 'Laptop notes', audience: 'Laptop audience' };
  const draft = { preachDates: [phone] };
  const stored: ResourceSnapshot = { ...basis, value: { preachDates: [laptop] },
    metadata: { ...basis.metadata!, revision: 3 } };
  const { conflicts } = mergeDocumentFields(basis.value, draft, stored.value);
  expect(conflicts.map(({ path }) => path[2])).toEqual(['notes', 'audience']);
  expect(keepUncontestedSermonFields(basis, draft, stored, conflicts)?.preachDates)
    .toEqual([{ ...laptop, date: phone.date }]);
});

it.each(['local', 'remote'] as const)('keeps the ordered return while choosing the %s notes', side => {
  const original: SermonOutline = { introduction: [], conclusion: [], main: [
    { id: 'opening', text: 'Opening point', subPoints: [{ id: 'child', text: 'Subpoint', note: 'Opening notes', position: 0 }] },
    { id: 'desktop', text: 'Desktop destination', subPoints: [] },
  ] };
  const notes = (outline: SermonOutline, note: string): SermonOutline => ({ ...outline,
    main: outline.main.map(point => ({ ...point, subPoints: point.subPoints?.map(child => ({ ...child, note })) })),
  });
  const basis: ResourceSnapshot = { resource: { collection: 'sermons', id: 'sermon' },
    metadata: { protocol: 1, generation: 'original', revision: 1, deleted: false },
    value: { userId: 'owner', thoughts: [], outline: original as unknown as DocumentData } };
  const draft = replaceResourceOutline('sermons', basis.value!, notes(original, 'Phone notes'));
  const stored = { ...basis, metadata: { ...basis.metadata!, revision: 2 },
    value: replaceResourceOutline('sermons', basis.value!, notes(moveSubPoint(original, 'child', 'desktop', 0), 'Desktop notes')) };
  const conflicts = [{ path: ['outline'], code: 'outline-subpoint-review', outlineSubpointIds: ['child'],
    orderedOutlineSubpoints: [{ id: 'child', side: 'local' as const }],
    base: { exists: true, value: basis.value!.outline }, mine: { exists: true, value: draft.outline },
    theirs: { exists: true, value: stored.value.outline } }];
  const comparison = readOutlineParentComparison({ confirmed: basis, draft, remoteCandidate: stored, conflicts });
  const note = { id: 'note:child', field: 'note' as const, mine: 'Phone notes', stored: 'Desktop notes' };
  expect(comparison?.unresolvedMoves).toEqual([]);
  expect(comparison?.titles).toEqual([note]);
  expect(projectOutlineParentChoice(basis, draft, stored, conflicts, 'remote', [{ ...note, side }])?.outline)
    .toEqual(notes(original, side === 'local' ? 'Phone notes' : 'Desktop notes'));
});

it('chooses the disputed subpoints without discarding a move made on only one device', () => {
  const point = (id: string, child?: string) => ({ id, text: id, subPoints: child ? [{ id: child, text: child, position: 0 }] : [] });
  const opening: SermonOutline = { introduction: [], conclusion: [],
    main: [point('a', 'first'), point('b'), point('c'), point('d', 'second'), point('e'), point('f'), point('g', 'independent'), point('h')] };
  const mine = moveSubPoint(moveSubPoint(moveSubPoint(opening, 'first', 'b', 0), 'second', 'e', 0), 'independent', 'h', 0);
  const saved = moveSubPoint(moveSubPoint(opening, 'first', 'c', 0), 'second', 'f', 0);
  const value = (outline: SermonOutline): DocumentData => ({ structure: outline as unknown as DocumentData });
  const basis: ResourceSnapshot = { resource: { collection: 'planTemplates', id: 'outline' }, value: value(opening),
    metadata: { protocol: 1, generation: 'original', revision: 1, deleted: false } };
  const stored = { ...basis, value: value(saved), metadata: { ...basis.metadata!, revision: 2 } };
  const field = (outline: SermonOutline) => ({ exists: true, value: value(outline).structure });
  const conflicts = [{ path: ['structure'], code: 'outline-subpoint-review', outlineSubpointIds: ['first', 'second'],
    base: field(opening), mine: field(mine), theirs: field(saved) }];
  const comparison = readOutlineParentComparison({ confirmed: basis, draft: value(mine), remoteCandidate: stored, conflicts });
  expect(comparison?.unresolvedMoves.map(({ child }) => child.id)).toEqual(['first', 'second']);
  expect(projectOutlineParentChoice(basis, value(mine), stored, conflicts, 'remote')?.structure)
    .toEqual(moveSubPoint(saved, 'independent', 'h', 0));
  expect(projectOutlineParentChoice(basis, value(mine), stored, conflicts, 'local')?.structure).toEqual(mine);
});

it.each(['remote', 'local', 'new-local-parent', 'new-saved-parent', 'later-independent-words', 'later-same-parent', 'later-same-parent-different-slot', 'later-opening-parent', 'competing-words'] as const)(
  'keeps independent words and linked thoughts when resolving %s subpoint placement', scenario => {
  const differentSlot = scenario === 'later-same-parent-different-slot';
  const outline: SermonOutline = { introduction: [], main: [
    { id: 'opening', text: 'Opening point', subPoints: [{ id: 'child', text: 'Subpoint', position: 1000 }] },
    { id: 'phone', text: 'Phone destination', subPoints: differentSlot ? [{ id: 'sibling', text: 'Sibling', position: 0 }] : [] },
    { id: 'desktop', text: 'Desktop destination', subPoints: [] },
  ], conclusion: [] };
  const thought = { id: 'one', text: 'Opening words', tags: ['main'], date: '2026-11-13T00:00:00.000Z',
    outlinePointId: 'opening', subPointId: 'child' };
  const basis: ResourceSnapshot = {
    resource: { collection: 'sermons', id: 'sermon' },
    metadata: { protocol: 1, generation: 'original', revision: 1, deleted: false },
    value: { userId: 'owner', outline: outline as unknown as DocumentData, thoughts: [thought] },
  };
  if (scenario === 'new-local-parent') outline.main = outline.main.filter(point => point.id !== 'phone');
  if (scenario === 'new-saved-parent') outline.main = outline.main.filter(point => point.id !== 'desktop');
  const withParent = (id: string) => outline.main.some(point => point.id === id) ? outline : { ...outline,
    main: [...outline.main, { id, text: 'New destination', subPoints: [] }] };
  const phoneOutline = moveSubPoint(withParent('phone'), 'child', 'phone', 0);
  phoneOutline.main = phoneOutline.main.map(point => point.id === 'desktop'
    ? { ...point, text: 'Independent phone point title' } : point);
  const draft = replaceResourceOutline('sermons', { ...basis.value!, thoughts: [{ ...thought, text: 'Independent phone words' }] }, phoneOutline);
  const desktopOutline = moveSubPoint(withParent('desktop'), 'child', 'desktop', 0);
  desktopOutline.main = desktopOutline.main.map(point => point.id === 'opening'
    ? { ...point, text: 'Independent desktop point title' } : point.id === 'desktop' && scenario === 'competing-words'
      ? { ...point, text: 'Competing saved title' } : point);
  const stored: ResourceSnapshot = { ...basis, metadata: { ...basis.metadata!, revision: 2 },
    value: replaceResourceOutline('sermons', basis.value!, desktopOutline) };
  const { conflicts } = mergeDocumentFields(basis.value, draft, stored.value);
  expect(conflicts.map(({ path }) => path)).toEqual([['outline'], ['thoughts', 'id:one', 'outlinePointId']]);
  const side = scenario === 'local' || scenario === 'new-local-parent' ? 'local' : 'remote';
  const parent = side === 'local' || (scenario === 'later-same-parent' || differentSlot) ? 'phone' : scenario === 'later-opening-parent' ? 'opening' : 'desktop';
  const laterOutline = scenario === 'later-independent-words' ? { ...desktopOutline, main: desktopOutline.main.map(point => point.id === 'phone'
    ? { ...point, text: 'Later saved title' } : point) }
    : scenario === 'later-same-parent' || scenario === 'later-opening-parent' || differentSlot ? moveSubPoint(desktopOutline, 'child', parent, differentSlot ? 1 : 0) : null;
  const live = laterOutline ? { ...stored, metadata: { ...stored.metadata!, revision: 3 },
    value: replaceResourceOutline('sermons', stored.value!, laterOutline) } : stored;
  if (scenario === 'competing-words') {
    expect(() => projectOutlineParentChoice(basis, draft, live, conflicts, 'remote')).toThrow('other changes need review');
    const reviewed = { id: 'desktop', mine: 'Independent phone point title', stored: 'Competing saved title' };
    const root = conflicts[0];
    const serverTitle = (value: typeof root.base) => ({ ...value, value: { ...(value.value as DocumentData),
      main: ((value.value as DocumentData).main as DocumentData[]).map(point => point.id === reviewed.id ? { ...point, text: reviewed.stored } : point) } });
    const ordered = [{ ...root, base: serverTitle(root.base), mine: serverTitle(root.mine) }, ...conflicts.slice(1), {
      path: ['outline', 'main', 'id:desktop', 'text'], code: 'outline-title-settled',
      base: { exists: true, value: 'Desktop destination' }, mine: { exists: true, value: reviewed.mine },
      theirs: { exists: true, value: reviewed.stored },
    }];
    expect(readOutlineParentComparison({ confirmed: basis, draft, remoteCandidate: live, conflicts: ordered })?.titles).toEqual([]);
    const returned = { ...live, value: replaceResourceOutline('sermons', live.value!, { ...desktopOutline,
      main: desktopOutline.main.map(point => point.id === reviewed.id ? { ...point, text: 'Desktop destination' } : point) }) };
    const returnedTitle = { ...reviewed, stored: 'Desktop destination' };
    const stillReview = [...conflicts, { ...ordered.at(-1)!, code: 'outline-title-review', theirs: { exists: true, value: returnedTitle.stored } }];
    expect(readOutlineParentComparison({ confirmed: basis, draft, remoteCandidate: returned, conflicts: stillReview })?.titles).toEqual([returnedTitle]);
    expect(projectOutlineParentChoice(basis, draft, returned, stillReview, 'remote', [{ ...returnedTitle, side: 'remote' }])?.outline)
      .toMatchObject({ main: [{ id: 'opening' }, { id: 'phone' }, { id: 'desktop', text: returnedTitle.stored, subPoints: [{ id: 'child' }] }] });
    expect(projectOutlineParentChoice(basis, draft, live, ordered, 'local')?.outline).toMatchObject({
      main: [{ id: 'opening' }, { id: 'phone', subPoints: [{ id: 'child' }] }, { id: 'desktop', text: reviewed.stored }],
    });

    const queued = ordered.map(conflict => conflict.code === 'outline-title-settled' ? { ...conflict, code: 'outline-title-queued' } : conflict);
    const originalTime = { earliestMs: 1_800_000_000_001, latestMs: 1_800_000_000_006 };
    const action = { rowId: 'desktop', rowCreatedAt: 'desktop', before: 'Desktop destination', after: reviewed.mine,
      observedRevision: 1, time: originalTime };
    const request: CommitRequest = { id: 'queued-save', owner: 'owner', editorId: 'outline', editGeneration: 1, predecessor: null,
      baseline: basis, value: draft, revision: 1, initialized: true, working: basis, intended: draft, command: null, submitted: draft,
      sequence: 0, state: 'conflict', unfinalized: [], outlineTitleActions: [action],
      result: { kind: 'conflict', operationId: 'queued-save', snapshot: live, conflicts: queued } };
    const checkpoint: SessionCheckpoint = { confirmed: basis, draft, remoteCandidate: live, conflicts: queued, dirty: true,
      editGeneration: 1, pending: { [request.id]: { generation: 1, value: draft } } };
    const exact = projectExactManualChoice({ owner: 'owner', editorId: 'document', checkpoint, prepared: null, unfinalized: [] },
      { choice: 'remote', request, value: draft, stored: live, selection: [['outline'], ['thoughts']] }, [request])[0].checkpoint;
    expect(exact.outlineTitleDrafts?.desktop?.action).toEqual(action);
    const working = { ...basis, metadata: { ...basis.metadata!, revision: 2 }, value: { ...basis.value!,
      outline: { ...outline, main: outline.main.map(point => point.id === 'desktop' ? { ...point, text: 'Previously reviewed title' } : point) } as unknown as DocumentData } };
    expect(projectOutlineParentChoice(working, draft, live, queued, 'remote')?.outline).toEqual(exact.draft?.outline);
    expect(exact.draft?.outline).toMatchObject({ main: [{ id: 'opening' }, { id: 'phone' },
      { id: 'desktop', text: reviewed.mine, subPoints: [{ id: 'child' }] }] });
    expect(() => projectOutlineParentChoice(basis, draft, live, conflicts, 'remote', [{ ...reviewed, mine: 'Stale title', side: 'local' }]))
      .toThrow('other changes need review');
    const session = DataSession.restore({ confirmed: basis, draft, remoteCandidate: live, conflicts, dirty: true, editGeneration: 1, pending: {} });
    session.keepLocal(undefined, null, undefined, [{ ...reviewed, side: 'local' }]);
    expect(session.checkpoint().outlineTitleDrafts?.desktop?.action).toMatchObject({ rowId: 'desktop',
      observedRevision: live.metadata?.revision, before: reviewed.stored, after: reviewed.mine });
    for (const placement of ['local', 'remote'] as const) {
      for (const words of ['local', 'remote'] as const) {
        const selected = projectOutlineParentChoice(basis, draft, live, conflicts, placement, [{ ...reviewed, side: words }]);
        const destination = placement === 'local' ? 'phone' : 'desktop';
        const outline = selected?.outline as unknown as SermonOutline;
        expect(outline.main.filter(point => point.subPoints?.some(sub => sub.id === 'child')).map(point => point.id)).toEqual([destination]);
        expect(outline.main.find(point => point.id === 'desktop')?.text).toBe(words === 'local' ? reviewed.mine : reviewed.stored);
        expect(outline.main.find(point => point.id === 'opening')?.text).toBe('Independent desktop point title');
        expect(selected?.thoughts).toMatchObject([{ id: 'one', text: 'Independent phone words', outlinePointId: destination }]);
      }
    }
    return;
  }
  const selected = side === 'remote' ? keepUncontestedSermonFields(basis, draft, live, conflicts)
    : projectOutlineParentChoice(basis, draft, live, conflicts, side);
  expect(selected?.thoughts).toMatchObject([{ id: 'one', outlinePointId: parent, subPointId: 'child', text: 'Independent phone words' }]);
  const chosen = selected?.outline as unknown as SermonOutline;
  expect(chosen.main.find(point => point.id === 'opening')?.text).toBe('Independent desktop point title');
  expect(chosen.main.find(point => point.id === 'desktop')?.text).toBe(scenario === 'new-saved-parent' ? 'New destination' : 'Independent phone point title');
  expect(chosen.main.find(point => point.id === 'phone')?.text).toBe(scenario === 'later-independent-words' ? 'Later saved title'
    : scenario === 'new-local-parent' ? 'New destination' : 'Phone destination');
  if (differentSlot) expect(chosen.main.find(point => point.id === 'phone')?.subPoints?.map(child => child.id)).toEqual(['sibling', 'child']);
  expect(chosen.main.filter(point => point.subPoints?.some(child => child.id === 'child')).map(point => point.id)).toEqual([parent]);
});

it('shows the saved and current local parent in the manual comparison while the owner edits other words', () => {
  const outline = (parent: string, words = 'Third point') => ({ introduction: [], conclusion: [], main: [
    { id: 'a', text: 'First point' }, { id: 'b', text: 'Second point' }, { id: 'c', text: words },
  ].map(point => ({ ...point, subPoints: point.id === parent ? [{ id: 'child', text: 'Child', position: 0 }] : [] })) });
  const baseline: ResourceSnapshot = { resource: { collection: 'sermons', id: 'sermon' },
    metadata: { protocol: 1, generation: 'g', revision: 1, deleted: false }, value: { outline: outline('a') } };
  const value = { outline: outline('b') };
  const stored = { ...baseline, metadata: { ...baseline.metadata!, revision: 2 }, value: { outline: outline('c') } };
  const { conflicts } = mergeDocumentFields(baseline.value, value, stored.value);
  const request: CommitRequest = { id: 'save', owner: 'owner', editorId: 'scope', editGeneration: 1, predecessor: null,
    baseline, value, revision: 1, initialized: true, working: baseline, intended: value, command: null, submitted: value,
    sequence: 0, state: 'conflict', unfinalized: [], result: { kind: 'conflict', operationId: 'save', snapshot: stored, conflicts } };
  const amended = { outline: outline('b', 'Later independent words') };
  const form: ReturnType<ManualScope['getState']> = { record: { kind: 'manual', version: 1, resource: baseline.resource,
    owner: 'owner', scopeId: 'scope', selection: [['outline']], baseline, active: true, savedGeneration: 1, generation: 2,
    predecessor: { id: request.id, owner: 'owner', resource: baseline.resource, value, predecessorId: null },
    stage: [{ exists: true, value: amended.outline }], savedSelection: [{ exists: true, value: value.outline }] },
    value: amended, openingValue: baseline.value, dirty: true, durable: true, capturing: false };
  const checkpoint: SessionCheckpoint = { confirmed: baseline, remoteCandidate: stored, draft: value, dirty: true,
    editGeneration: 1, conflicts, pending: { save: { generation: 1, value } } };
  expect(manualComparison(form, checkpoint, new Map([[request.id, request]]), request)).toMatchObject({
    outlineParent: { moves: [{ local: { point: { id: 'b' } }, remote: { point: { id: 'c' } } }] },
    mine: amended,
  });
  expect(projectOutlineParentChoice(baseline, amended, stored, conflicts, 'remote')?.outline).toEqual(outline('c', 'Later independent words'));
  const movedBack = { ...baseline, metadata: { ...baseline.metadata!, revision: 3 } };
  expect(manualComparison(form, { ...checkpoint, remoteCandidate: movedBack }, new Map([[request.id, request]]), request))
    .toMatchObject({ outlineParent: { moves: [{ local: { point: { id: 'b' } }, remote: { point: { id: 'a' } } }] } });
});

it('can choose a saved scripture that returned to its opening value while retaining a separate title edit', () => {
  const basis: ResourceSnapshot = {
    resource: { collection: 'sermons', id: 'sermon' },
    metadata: { protocol: 1, generation: 'original', revision: 1, deleted: false },
    value: { userId: 'owner', title: 'Opening title', verse: 'John 3:16' },
  };
  const stored = { ...basis, metadata: { ...basis.metadata!, revision: 3 } };
  const draft = { ...basis.value!, title: 'Edited title', verse: 'Romans 8:1' };
  expect(keepUncontestedSermonFields(basis, draft, stored, [{
    path: ['verse'], base: { exists: true, value: 'John 3:16' },
    mine: { exists: true, value: 'Romans 8:1' }, theirs: { exists: true, value: 'John 3:16' },
  }])).toEqual({ userId: 'owner', title: 'Edited title', verse: 'John 3:16' });
});


it('keeps an answered scripture comparison visible when the saved text returned to its opening value', () => {
  const basis: ResourceSnapshot = {
    resource: { collection: 'sermons', id: 'sermon' },
    metadata: { protocol: 1, generation: 'original', revision: 1, deleted: false },
    value: { userId: 'owner', verse: 'John 3:16' },
  };
  const stored = { ...basis, metadata: { ...basis.metadata!, revision: 3 } };
  const value = { ...basis.value!, verse: 'Romans 8:1' };
  const editedVerse = { exists: true, value: value.verse };
  const savedVerse = { exists: true, value: 'John 3:16' };
  const conflicts = [{ path: ['verse'], base: savedVerse, mine: editedVerse, theirs: savedVerse }];
  const request: CommitRequest = {
    id: 'save', owner: 'owner', editorId: 'scope', editGeneration: 1, predecessor: null,
    baseline: basis, value, revision: 1, initialized: true, working: basis, intended: value,
    command: null, submitted: value, sequence: 0, state: 'conflict', unfinalized: [],
    result: { kind: 'conflict', operationId: 'save', snapshot: stored, conflicts },
  };
  const stage: ReturnType<ManualScope['getState']> = {
    record: { kind: 'manual', version: 1, resource: basis.resource, owner: 'owner', scopeId: 'scope', selection: [['verse']],
      baseline: basis, predecessor: { id: request.id, owner: 'owner', resource: basis.resource, value, predecessorId: null },
      stage: [editedVerse], savedSelection: [editedVerse], generation: 1, savedGeneration: 1, active: true },
    value, openingValue: basis.value, dirty: false, durable: true, capturing: false,
  };
  const parent: SessionCheckpoint = { confirmed: basis, remoteCandidate: stored, draft: value, dirty: true,
    editGeneration: 1, conflicts, pending: { save: { generation: 1, value } } };
  expect(manualComparison(stage, parent, new Map([[request.id, request]]), request)).toMatchObject({
    conflictPaths: [['verse']], mine: value, stored,
  });
});


it('keeps independent words and tags when using the saved membership of one thought tag', () => {
  const date = '2026-11-08T00:00:00.000Z';
  const thought = { id: 'one', date, text: 'Opening thought', tags: ['main', 'Alpha'] };
  const basis: ResourceSnapshot = {
    resource: { collection: 'sermons', id: 'sermon' },
    metadata: { protocol: 1, generation: 'original', revision: 1, deleted: false },
    value: { userId: 'owner', thoughts: [thought] },
  };
  const stored = { ...basis, metadata: { ...basis.metadata!, revision: 3 },
    value: { userId: 'owner', thoughts: [{ ...thought, tags: ['main', 'Alpha', 'Other device'] }] } };
  const draft = { userId: 'owner', thoughts: [{ ...thought, text: 'Edited thought', tags: ['main', 'Beta'] }] };
  const conflicts = [{
    path: ['thoughts', 'id:one', 'tags', 'string:Alpha'], base: { exists: true, value: true },
    mine: { exists: true, value: false }, theirs: { exists: true, value: true },
  }];
  const selected = keepUncontestedSermonFields(basis, draft, stored, conflicts);
  expect(selected?.thoughts).toEqual([{ ...thought, text: 'Edited thought', tags: expect.arrayContaining(['main', 'Alpha', 'Other device', 'Beta']) }]);
  const replacement = { ...stored, value: { userId: 'owner', thoughts: [{ ...thought, date: '2026-11-09T00:00:00.000Z' }] } };
  expect(keepUncontestedSermonFields(basis, draft, replacement, conflicts)).toBeUndefined();
});


it('compares the two plan modes while retaining words independently of the mode choice', () => {
  const basis: ResourceSnapshot = {
    resource: { collection: 'sermons', id: 'sermon' },
    metadata: { protocol: 1, generation: 'original', revision: 1, deleted: false },
    value: { userId: 'owner', planMode: 'manual', planText: { opening: 'Previous intro', end: 'Previous conclusion' } },
  };
  const stored = { ...basis, metadata: { ...basis.metadata!, revision: 3 },
    value: { ...basis.value!, planMode: 'ai', planText: { opening: 'Previous intro', end: 'Saved conclusion' } } };
  const draft = { ...basis.value!, planMode: 'note', planText: { opening: 'My edited intro', end: 'Previous conclusion' } };
  const mine = { exists: true, value: 'note' };
  const theirs = { exists: true, value: 'ai' };
  const conflicts = [{ path: ['planMode'], base: { exists: true, value: 'manual' }, mine, theirs }];
  const checkpoint: SessionCheckpoint = { confirmed: basis, remoteCandidate: stored, draft,
    conflicts, editGeneration: 1, dirty: true, pending: {} };
  expect(readSermonPlanModeComparison(checkpoint)).toMatchObject({ mine, stored: theirs });
  expect(keepUncontestedSermonFields(basis, draft, stored, conflicts)?.planText)
    .toEqual({ opening: 'My edited intro', end: 'Saved conclusion' });
  const changedWords = { ...stored, metadata: { ...stored.metadata, revision: 4 },
    value: { ...stored.value, planText: { opening: 'New saved intro', end: 'Saved conclusion' } } };
  expect(readSermonPlanModeComparison({ ...checkpoint, remoteCandidate: changedWords })).toBeUndefined();
});

it('keeps the second scratch note opening when the first queued note gets a separate choice', () => {
  const resource = { collection: 'sermons', id: 's1' };
  const snapshot = (revision: number, first: string, second: string): ResourceSnapshot => ({
    resource, metadata: { protocol: 1, generation: 'g1', revision, deleted: false },
    value: { userId: 'owner', scratch: [{ id: 'one', createdAt: 't1', text: first }, { id: 'two', createdAt: 't2', text: second }] },
  });
  const baseline = snapshot(1, 'A at opening', 'B at opening');
  const firstDraft = snapshot(1, 'A on phone', 'B at opening').value;
  const secondDraft = snapshot(1, 'A on phone', 'B on phone').value;
  const stored = snapshot(2, 'A on computer', 'B on computer');
  const first: CommitRequest = { id: 'first', owner: 'owner', editorId: 'scratch', editGeneration: 1,
    predecessor: null, baseline, working: baseline, value: firstDraft, intended: firstDraft,
    initialized: true, command: null, submitted: firstDraft, revision: 1, sequence: 0, state: 'cancelled', result: null, unfinalized: [] };
  const second: CommitRequest = { ...first, id: 'second', predecessor: first.id, editGeneration: 2,
    initialized: false, value: secondDraft, intended: secondDraft, submitted: null, retainedAfterChoice: true,
    sermonNoteText: { sermonId: resource.id, generation: 'g1', pending: [], target: { kind: 'scratch', id: 'two', createdAt: 't2' }, text: 'B at opening' } };
  const [copy] = projectSavedChoiceDependents('owner', first, stored, stored.value, [first, second]);
  const reopened = validateRecoveryRecord(copy, copy.owner, copy.editorId, resource);
  const recovered = recoverManualChoiceCopy(reopened, stored);
  expect(recovered.checkpoint).toMatchObject({
    draft: snapshot(2, 'A on computer', 'B on phone').value,
    remoteCandidate: stored,
    conflicts: [{ path: ['scratch', 'id:two', 'text'], base: { value: 'B at opening' },
      mine: { value: 'B on phone' }, theirs: { value: 'B on computer' } }],
  });
});
