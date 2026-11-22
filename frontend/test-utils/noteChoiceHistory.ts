import { act, fireEvent, screen, within } from '@testing-library/react';
import { noteRef } from './deviceWorld';
import { diffFields } from '@/data-engine/protocol';
import { processCommand } from '@/data-engine/server';
import { serializeContent } from '@/utils/contentFingerprint';
import { noteRecordingMetadata } from '@/utils/studyNoteRecordings';
import type { ManagedEditor } from '@/data-engine/engine';
import type { CommitRequest } from '@/data-engine/commits';
import { COMMIT_ROW_KINDS } from '@/data-engine/retention.client';
import type { DataCommand, CommandResult } from '@/data-engine/types';
import type { NoteDraftPayload } from '@/(pages)/(private)/studies/[id]/noteDraft';
import type { QuestionSnapshot } from './noteOrderingOracles';
import { stand, start, disposeHistory, md, insert, pulse, publishDictation,
  hasGlobalNotice, hasInlineQuestion, hasNoteQuestion } from './noteChoiceStand';
import { choiceOracleNames, choiceVerdicts, type Answer, type ChoiceObservation, type ChoiceSnapshot, type ChoiceOracle, type Verdict } from './noteChoiceOracles';

export type ChoiceActionKind = 'holdTransport' | 'releaseTransport' | 'phoneOther' | 'phoneLive' | 'phoneBase'
  | 'openNotice' | 'keep' | 'pauseKeep' | 'take' | 'confirmTake' | 'resume'
  | 'holdCollection' | 'deliverLatest' | 'deliverAll' | 'type' | 'dictate' | 'done' | 'edit'
  | 'offline' | 'online' | 'inlineKeep' | 'inlineTake' | 'timer';
export type ChoiceAction = { kind: ChoiceActionKind; word?: string };
type Send = { command: DataCommand; issued: number; event: number; renderAtSend: number; response?: CommandResult; refused?: number; renderAtRefusal?: number };
export type ChoiceRun = ChoiceObservation & { id: string; actions: ChoiceAction[]; valid: boolean;
  invalid?: string; requests: Send[]; verdicts: ReturnType<typeof choiceVerdicts>; terminal: ChoiceSnapshot; checkpoints: { event: number; sends: number; quiescent: boolean; editor: string; stored: string; confirmed?: string; page: string; question: boolean; editorMounted: boolean; saved: boolean; renders: number; verdicts: Record<ChoiceOracle, Verdict> }[] };
const button = (name: string | RegExp) => screen.queryByRole('button', { name });
const enabled = (element: HTMLElement | null) => !!element && !(element as HTMLButtonElement).disabled;
const names = {
  keep: /^(freshness\.conflictKeepMine|dataSync\.useLocalVersion|dataSync\.keepLocal)$/,
  take: /^(freshness\.conflictTakeTheirs|dataSync\.useStoredVersion|dataSync\.acceptRemote)$/,
  confirm: /^(common\.discardText|dataSync\.confirmStoredField|dataSync\.confirmStoredFields)\.confirm$/,
};
const values = (raw: Partial<NoteDraftPayload>): NoteDraftPayload => ({
  title: raw.title || '', content: raw.content || '', tags: raw.tags || [], scriptureRefs: raw.scriptureRefs || [],
  type: raw.type || 'note', ...noteRecordingMetadata(raw.dictationSourceIds, raw.recordingSourceIds),
});

/** Latency gates only; no synthesized engine state, choice announcement, or notification payload. */
export class ChoiceMachine {
  actions: ChoiceAction[] = [];
  checkpoints: ChoiceRun['checkpoints'] = [];
  violatedAtSteps: Partial<Record<ChoiceOracle, number[]>> = {};
  steps: ChoiceSnapshot[] = [];
  questions: QuestionSnapshot[] = [];
  requests: Send[] = [];
  answers: Answer[] = [];
  typed: { word: string; sequence: number }[] = [];
  arrived: string[] = [];
  sequence = 0;
  remoteEpoch = 0;
  transportHeld = false;
  private releases: Array<() => void> = [];
  private captureReleases: Array<() => void> = [];
  private editorSpy?: jest.SpyInstance;
  private pauseArmed = false;
  private takeSurface?: 'notice' | 'inline';
  private activeKeep?: Answer;
  private received!: NoteDraftPayload;
  private originalConfirmed!: string;
  private lastRefusal?: Send;
  private observing = false;
  private captureSequences = new Map<string, number>();
  private canonical = new Map<string, CommitRequest>();
  get paused() { return this.captureReleases.length > 0; }
  get waiting() { return this.releases.length; }
  async boot() {
    await start();
    this.received = values(stand.world.server.documents.get('studyNotes/note-x')!);
    this.originalConfirmed = stand.confirmed?.content ?? this.received.content;
    const engine = stand.laptop.engine, open = engine.openEditor.bind(engine);
    const take = engine.takeStoredVersion.bind(engine);
    jest.spyOn(engine, 'takeStoredVersion').mockImplementation(async (...args) => {
      const answer = this.answers.at(-1);
      const result = await take(...args);
      // A fulfilled cancellation completes the modern path, including a
      // successful no-op. Opening the legacy editor below reinstates its gate.
      if (answer?.surface === 'notice' && answer.kind === 'take') answer.completed = true;
      return result;
    });
    const instrument = (editor: ManagedEditor, editorId: string) => {
      const save = editor.save.bind(editor);
      const keep = editor.keepLocal.bind(editor);
      const accept = editor.acceptRemote.bind(editor);
      let kept: Answer | undefined;
      editor.keepLocal = async (...args) => {
        const answer = this.answers.at(-1);
        if (answer?.kind === 'keep') kept = answer;
        await keep(...args);
        if (kept) kept.completed = true;
      };
      editor.acceptRemote = async (...args) => {
        const answer = this.answers.at(-1);
        await accept(...args);
        if (answer?.kind === 'take') answer.completed = true;
      };
      editor.save = async () => {
        const answer = this.answers.at(-1);
        if (answer?.kind === 'keep') answer.replacementEditorId = editorId;
        // Pause the actual save before it captures any replacement on this device.
        if (this.pauseArmed) await new Promise<void>(resolve => this.captureReleases.push(resolve));
        return save();
      };
      return editor;
    };
    const current = stand.activeEditor;
    if (!current) throw new Error('The note session did not open');
    instrument(current.editor, current.id);
    this.editorSpy = jest.spyOn(engine, 'openEditor').mockImplementation(async (...args) => instrument(await open(...args), args[1]));
    const deliver = stand.laptop.transport.send.bind(stand.laptop.transport);
    jest.spyOn(stand.laptop.transport, 'send').mockImplementation(async command => {
      this.readCaptures();
      const request: Send = { command, issued: this.captureSequences.get(command.operationId) ?? ++this.sequence, event: this.actions.length - 1, renderAtSend: stand.renderCount };
      this.requests.push(request);
      if (this.transportHeld) await new Promise<void>(resolve => this.releases.push(resolve));
      const response = await deliver(command);
      request.response = response;
      if ('snapshot' in response && response.snapshot.value) this.received = values(response.snapshot.value);
      if (response.kind !== 'acknowledged') {
        request.refused = ++this.sequence; request.renderAtRefusal = stand.renderCount; this.lastRefusal = request;
      }
      return response;
    });
    stand.observe(() => this.observe());
    this.observe();
  }
  private raw() { return stand.world.server.documents.get('studyNotes/note-x')!; }
  observe() {
    if (this.observing) return;
    this.observing = true;
    try {
      this.readCaptures();
      const editorMounted = !stand.editor.isDestroyed && !!document.querySelector('.tiptap');
      const editor = md(), page = stand.autosave.content, stored = String(this.raw().content);
      if (this.activeKeep && this.activeKeep.remote !== this.activeKeep.local
        && ((editorMounted && editor === this.activeKeep.remote) || page === this.activeKeep.remote)) {
        this.activeKeep.rejectedShown = true;
        this.activeKeep.rejectionWitness ??= { event: this.actions.length - 1, editor, page,
          remote: this.activeKeep.remote, renders: stand.renderCount, pauseArmed: this.pauseArmed,
          replacementCaptured: !!this.activeKeep.replacementRequestId };
      }
      const pageValues = values(stand.autosave), storedValues = values(this.raw());
      const question = hasNoteQuestion(), saved = (document.body.textContent ?? '').includes('common.saved');
      // The visible disclosure identifies exactly its real (possibly collapsed)
      // panel. Never search an ancestor that could include the note editor itself.
      const trigger = Array.from(document.querySelectorAll('button[aria-controls]'))
        .find(element => element.textContent === 'dataSync.readerNotices');
      const panelId = trigger?.getAttribute('aria-controls');
      const noticeText = panelId ? document.getElementById(panelId)?.textContent ?? '' : '';
      const coveredWords = this.typed.filter(({ word }) => (hasInlineQuestion() && page.includes(word))
        || (hasGlobalNotice() && noticeText.includes(word))).map(token => token.word);
      const step: ChoiceSnapshot = { event: this.actions.length - 1, sequence: ++this.sequence, editor, page, stored,
        confirmed: stand.confirmed?.content, editorMounted, dom: document.querySelector('.tiptap')?.textContent ?? screen.queryByTestId('read-note')?.textContent ?? '', question, saved,
        unsaved: serializeContent(pageValues) !== serializeContent(stand.confirmed) || !saved,
        coveredWords, noticeText, pageValues, storedValues, confirmedValues: stand.confirmed, sends: this.requests.length, renders: stand.renderCount, collectionHeld: stand.collectionHeld };
      this.steps.push(step);
      this.questions.push({ eventIndex: step.event, sequence: step.sequence, online: stand.laptop.online,
        receivedValues: this.received, pageValues, storedValues, question, blocked: !!stand.autosave.saveBlocked,
        refusedRequests: this.requests.filter(request => request.refused !== undefined).map(request => ({ issued: request.issued, refused: request.refused! })) });
    } finally { this.observing = false; }
  }
  /** Enumerate only currently possible public events. Hidden dock contents never enable a choice. */
  offered(): ChoiceActionKind[] {
    const result: ChoiceActionKind[] = ['timer', this.transportHeld ? 'releaseTransport' : 'holdTransport',
      stand.collectionHeld ? 'deliverLatest' : 'holdCollection'];
    if (stand.collectionHeld) result.push('deliverAll');
    if (this.paused) result.push('resume');
    if (stand.laptop.online) result.push('offline'); else result.push('online');
    result.push('phoneOther', 'phoneLive', 'phoneBase');
    if (screen.queryByTitle('common.done')) result.push('type', 'dictate', 'done');
    if (screen.queryByTitle('common.edit')) result.push('edit');
    if (hasGlobalNotice() && !document.querySelector('[data-sync-notice-open]')) result.push('openNotice');
    const section = document.querySelector('[data-sync-notice-open] section');
    if (section && !this.paused && !this.pauseArmed) {
      if (enabled(within(section as HTMLElement).queryByRole('button', { name: names.keep }))) result.push('keep', 'pauseKeep');
      if (enabled(within(section as HTMLElement).queryByRole('button', { name: names.take }))) result.push('take');
    }
    if (hasInlineQuestion() && !this.paused && !this.pauseArmed) {
      const workspace = document.querySelector('[data-note-workspace]') as HTMLElement;
      if (enabled(within(workspace).queryByRole('button', { name: names.keep }))) {
        result.push('inlineKeep');
        if (!result.includes('pauseKeep')) result.push('pauseKeep');
      }
      if (enabled(within(workspace).queryByRole('button', { name: names.take }))) result.push('inlineTake');
    }
    if (enabled(button(names.confirm))) return ['confirmTake'];
    return result;
  }
  private armPause() { this.pauseArmed = true; }
  private readCaptures() {
    // Read only the committed stand database. This observes immutable canonical
    // request IDs, editor ownership and capture order without adding storage I/O,
    // fake ACKs or changes to production's event schedule.
    const rows = stand.laptop.storage.databases.get('preacher-data-engine-state-v1');
    for (const [key, value] of rows ?? []) {
      if (!(COMMIT_ROW_KINDS as readonly string[]).includes(JSON.parse(key)[0])) continue;
      const request = value as CommitRequest;
      if (request.baseline.resource.collection !== 'studyNotes' || request.baseline.resource.id !== 'note-x') continue;
      this.canonical.set(request.id, request);
      if (!this.captureSequences.has(request.id)) this.captureSequences.set(request.id, ++this.sequence);
    }
    const answer = this.activeKeep;
    if (!answer?.replacementEditorId) return;
    const replacement = [...this.canonical.values()].find(request => request.editorId === answer.replacementEditorId
      && this.captureSequences.get(request.id)! > answer.sequence);
    if (!replacement) return;
    answer.replacementRequestId = replacement.id;
    if (replacement.state === 'acknowledged') { answer.replacement = 'accepted'; this.activeKeep = undefined; }
    else if (replacement.state === 'conflict' || replacement.state === 'refused') answer.replacement = 'refused';
  }
  private answer(kind: 'keep' | 'take', surface: 'notice' | 'inline') {
    if (this.activeKeep) this.activeKeep = undefined;
    const refusedId = this.lastRefusal?.command.operationId;
    const pending = stand.activeEditor?.editor.getState().checkpoint.pending ?? {};
    const answersRefusal = refusedId && (surface === 'notice'
      || Object.entries(pending).some(([id, intent]) => id === refusedId || intent.operations?.includes(refusedId)));
    const captureSequence = answersRefusal ? this.lastRefusal?.issued : undefined;
    const answer: Answer = { kind, surface, event: this.actions.length - 1, sequence: ++this.sequence,
      local: md(), remote: String(this.raw().content), captureSequence,
      newer: captureSequence === undefined ? [] : this.typed.filter(token => token.sequence > captureSequence).map(token => token.word),
      sendStart: this.requests.length, remoteEpoch: this.remoteEpoch, completed: false, rejectedShown: false,
      collectionHeldAtChoice: stand.collectionHeld,
      noRenderRefusal: this.lastRefusal?.renderAtRefusal === stand.renderCount };
    this.answers.push(answer);
    if (kind === 'keep') this.activeKeep = answer;
    return answer;
  }
  async tick(ms = 0) {
    await act(async () => { await pulse(ms); });
    this.observe();
  }
  async refresh() {
    if (stand.laptop.online) {
      await stand.laptop.run(() => stand.laptop.engine.refreshCollection('studyNotes'));
      this.received = values(this.raw());
    }
  }
  async phone(content: string) {
    const before = await stand.world.snapshot(noteRef);
    const changes = diffFields(before.value!, { ...before.value!, content });
    if (changes.length) {
      const response = await processCommand('owner', { protocol: 1, kind: 'update', owner: 'owner', operationId: stand.world.id('phone'),
        resource: noteRef, generation: before.metadata!.generation, dependsOn: [], changes });
      if (response.kind !== 'acknowledged') throw new Error(`Phone failed: ${response.kind}`);
      this.remoteEpoch++;
    }
    await act(async () => { await this.refresh(); await pulse(); });
  }
  async step(action: ChoiceAction) {
    if (!this.offered().includes(action.kind)) throw new Error(`Invalid action ${action.kind}`);
    this.actions.push(action);
    const kind = action.kind;
    if (kind === 'holdTransport') this.transportHeld = true;
    else if (kind === 'releaseTransport') { this.transportHeld = false; this.releases.splice(0).forEach(release => release()); }
    else if (kind === 'holdCollection') stand.holdCollection();
    else if (kind === 'deliverLatest' || kind === 'deliverAll') {
      if (kind === 'deliverAll') await stand.deliverAllCollection();
      else await act(async () => { stand.releaseCollection('latest'); });
    } else if (kind === 'resume') this.resume();
    else if (kind === 'offline') stand.laptop.goOffline();
    else if (kind === 'online') { stand.laptop.online = true; stand.laptop.run(() => stand.laptop.engine.setOnline(true)); await this.refresh(); }
    else if (kind === 'phoneOther' || kind === 'phoneLive' || kind === 'phoneBase') {
      const content = kind === 'phoneLive' ? (document.querySelector('.tiptap') ? md() : stand.autosave.content) : kind === 'phoneBase' ? stand.confirmed?.content ?? this.originalConfirmed : this.originalConfirmed + ' ' + action.word;
      if (kind === 'phoneOther') this.arrived.push(action.word!);
      if (kind === 'phoneLive') this.arrived = this.arrived.filter(word => content.includes(word));
      await this.phone(content);
    } else if (kind === 'type' || kind === 'dictate') {
      this.typed.push({ word: action.word!, sequence: ++this.sequence });
      await act(async () => {
        if (kind === 'type') insert(' ' + action.word);
        else await publishDictation(action.word!, 'source-' + action.word);
      });
    } else if (kind === 'done' || kind === 'edit') fireEvent.click(screen.getByTitle(kind === 'done' ? 'common.done' : 'common.edit'));
    else if (kind === 'openNotice') fireEvent.click(button('dataSync.readerNotices')!);
    else if (kind === 'keep' || kind === 'pauseKeep' || kind === 'inlineKeep') {
      if (kind === 'pauseKeep') this.armPause();
      const section = document.querySelector<HTMLElement>('[data-sync-notice-open] section');
      const useInline = kind === 'inlineKeep' || (kind === 'pauseKeep' && !section);
      this.answer('keep', useInline ? 'inline' : 'notice');
      const root = useInline ? document.querySelector('[data-note-workspace]') : section;
      fireEvent.click(within(root as HTMLElement).getByRole('button', { name: names.keep }));
    } else if (kind === 'take' || kind === 'inlineTake') {
      this.takeSurface = kind === 'inlineTake' ? 'inline' : 'notice';
      const root = this.takeSurface === 'inline' ? document.querySelector('[data-note-workspace]') : document.querySelector('[data-sync-notice-open] section');
      fireEvent.click(within(root as HTMLElement).getByRole('button', { name: names.take }));
    } else if (kind === 'confirmTake') {
      this.answer('take', this.takeSurface!);
      fireEvent.click(button(names.confirm)!);
    }
    await this.tick(kind === 'timer' ? 1600 : 0);
    this.assessCheckpoint();
  }
  private assessCheckpoint() {
    const row = this.observation(), final = row.steps.at(-1)!;
    const verdicts = choiceVerdicts({ ...row, violatedAtSteps: undefined });
    // These obligations explicitly require all delivery and timers to have settled.
    // An empty engine queue is not proof that page effects/autosave timers settled.
    // Evaluate their complete clauses only after the mandatory terminal drain.
    for (const name of ['I4', 'C2', 'C3', 'C4', 'C5'] as const) verdicts[name] = 'not applicable';
    const quiescent = !this.transportHeld && !stand.collectionHeld && !this.paused && !this.pauseArmed
      && !stand.laptop.engine.getPending().some(entry => ['queued', 'sending'].includes(entry.state));
    for (const [name, verdict] of Object.entries(verdicts)) if (verdict === 'violation') {
      const key = name as ChoiceOracle;
      (this.violatedAtSteps[key] ??= []).push(this.actions.length - 1);
    }
    this.checkpoints.push({ event: this.actions.length - 1, sends: this.requests.length, quiescent, editor: final.editor, stored: final.stored, confirmed: final.confirmed,
      page: final.page, question: final.question, editorMounted: final.editorMounted, saved: final.saved, renders: final.renders, verdicts });
  }
  resume() {
    this.pauseArmed = false;
    this.captureReleases.splice(0).forEach(release => release());
  }
  async settleAll() {
    this.resume(); this.transportHeld = false; this.releases.splice(0).forEach(release => release());
    stand.laptop.online = true; stand.laptop.run(() => stand.laptop.engine.setOnline(true));
    await stand.deliverAllCollection();
    await act(async () => { await this.refresh(); });
    for (const ms of [0, 1600, 2000, 5000, 30000]) await this.tick(ms);
    await act(async () => { await stand.world.settle(); });
    this.observe();
  }
  observation(): ChoiceObservation {
    return { events: this.actions.map(action => ({ kind: action.kind === 'phoneOther' ? 'arriveOther'
      : action.kind === 'phoneLive' ? 'arriveLive' : action.kind === 'phoneBase' ? 'arriveSame' : action.kind })),
    violatedAtSteps: this.violatedAtSteps, steps: [...this.steps], questions: [...this.questions], answers: this.answers.map(answer => ({ ...answer })),
    typed: [...this.typed], arrived: [...this.arrived], remoteEpoch: this.remoteEpoch };
  }
  async continuation(row: ChoiceObservation) {
    const last = row.answers.at(-1), end = row.steps.at(-1)!;
    if (!last || !last.completed || !end.editorMounted || last.remoteEpoch !== row.remoteEpoch) return;
    const isTake = last.kind === 'take' && last.newer.length === 0
      && !row.typed.some(token => token.sequence > (last.captureSequence ?? -1));
    const isKeep = last.kind === 'keep' && last.replacement === 'accepted'
      && !row.typed.some(token => token.sequence > last.sequence);
    if (!isTake && !isKeep) return;
    // These are measured acceptance continuations, outside the generated send budget.
    const expected = end.editor + ' Continuationword';
    await act(async () => { insert(' Continuationword'); });
    for (const ms of [1600, 2000, 5000, 30000]) await this.tick(ms);
    const nextStored = String(this.raw().content), nextEditor = md(), question = hasNoteQuestion();
    const nextSaved = nextStored === expected && nextEditor === expected && !question;
    let cleanArrival: boolean | undefined;
    let arrivalEditor: string | undefined, arrivalStored: string | undefined, arrivalQuestion: boolean | undefined;
    if (isKeep && nextSaved) {
      await this.phone('Cleanarrivalword');
      for (const ms of [0, 1600, 2000, 5000]) await this.tick(ms);
      arrivalEditor = md(); arrivalStored = String(this.raw().content); arrivalQuestion = hasNoteQuestion();
      cleanArrival = arrivalEditor === 'Cleanarrivalword' && !arrivalQuestion;
    }
    row.continuation = { nextSaved, cleanArrival, nextStored, nextEditor, question, arrivalEditor, arrivalStored, arrivalQuestion };
  }
  close() { stand.observe(undefined); this.resume(); this.editorSpy?.mockRestore(); this.releases.splice(0).forEach(release => release()); disposeHistory(); }
}

export async function runChoiceHistory(actions: ChoiceAction[], id: string): Promise<ChoiceRun> {
  const machine = new ChoiceMachine();
  await machine.boot();
  let invalid: string | undefined;
  try {
    for (const action of actions) {
      if (!machine.offered().includes(action.kind)) { invalid = `Action ${machine.actions.length}: ${action.kind}`; break; }
      await machine.step(action);
    }
    await machine.settleAll();
    const row = machine.observation();
    await machine.continuation(row);
    return { ...row, id, actions, valid: !invalid, invalid, requests: machine.requests,
      terminal: row.steps.at(-1)!, checkpoints: [...machine.checkpoints], verdicts: invalid
        ? Object.fromEntries(choiceOracleNames.map(name => [name, 'not applicable'])) as ReturnType<typeof choiceVerdicts>
        : choiceVerdicts(row) };
  } finally { machine.close(); }
}
