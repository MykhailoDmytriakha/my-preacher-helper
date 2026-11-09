import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import React from 'react';

import { useSermonCoreDataDocument } from '@/(pages)/(private)/sermons/[id]/hooks/useSermonCoreDataDocument';
import TextContextStepContent from '@/components/sermon/prep/TextContextStepContent';
import HomileticPlanStepContent from '@/components/sermon/prep/HomileticPlanStepContent';
import ExegeticalPlanModule from '@/components/sermon/prep/exegeticalPlan/ExegeticalPlanModule';
import { AuthorIntentField } from '@/components/sermon/prep/exegeticalPlan/AuthorIntentField';
import ThesisStepContent from '@/components/sermon/prep/ThesisStepContent';
import GoalsStepContent from '@/components/sermon/prep/GoalsStepContent';
import type { PreparationTextBinding } from '@/components/common/manualTextBinding';
import MainIdeaStepContent from '@/components/sermon/prep/MainIdeaStepContent';
import { useAuth } from '@/providers/AuthProvider';
import { documentEngineHarness, settleEngine } from '@test-utils/documentEngineHarness';

import { createBrowserDataEngine } from '../browser.client';
import { DataSyncStatus } from '../DataSyncStatus';
import * as manualStores from '../manualScopes.client';
import { DataDocumentProvider, DataEngineProvider, useDataDocument } from '../react.client';

import type { DocumentData } from '../types';

jest.mock('idb-keyval', () => ({ createStore: jest.fn() }));
jest.mock('../manualScopes.client', () => {
  const actual = jest.requireActual('../manualScopes.client');
  return { ...actual, createIndexedDbManualScopes: jest.fn(actual.createIndexedDbManualScopes) };
});
jest.mock('@/providers/AuthProvider', () => ({ useAuth: jest.fn() }));
jest.mock('../browser.client', () => ({ createBrowserDataEngine: jest.fn() }));
jest.mock('@/components/navigation/shellTitles', () => ({ usePublishShellTitle: jest.fn() }));
jest.mock('@locales/useTranslation', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

const resource = { collection: 'sermons', id: 'prep-field-repro' };
const initial = { userId: 'owner', title: 'Preparation QA', verse: 'John 3:16', date: 'now', thoughts: [],
  preparation: { mainIdea: { contextIdea: 'Opening preparation words', textIdea: 'Sibling words' } } };
function PageField({ shown = true, withStatus = false, allFields = false, section = 'mainIdea' }: { shown?: boolean; withStatus?: boolean; allFields?: boolean; section?: 'mainIdea' | 'goals' | 'thesis' | 'authorIntent' | 'homileticPlan' | 'textContext' }) {
  const core = useSermonCoreDataDocument(resource.id);
  const rawDocument = useDataDocument(resource);
  const goalFields = (core as typeof core & { goalFields?: Record<string, PreparationTextBinding> }).goalFields;
  const goals = <GoalsStepContent {...{ goalType: goalFields?.type, initialGoalType: core.preparation.preachingGoal?.type, onSaveGoalType: (type: 'informative' | 'proclamation' | 'didactic' | 'exhortative') => core.patchPreparation({ preachingGoal: { ...core.preparation.preachingGoal, type } }), timelessTruth: goalFields?.timelessTruth, christConnection: goalFields?.christConnection, goalStatement: goalFields?.statement,
    initialTimelessTruth: core.preparation.timelessTruth, onSaveTimelessTruth: (text: string) => core.patchPreparation({ timelessTruth: text }),
    initialChristConnection: core.preparation.christConnection, onSaveChristConnection: (text: string) => core.patchPreparation({ christConnection: text }),
    initialGoalStatement: core.preparation.preachingGoal?.statement, onSaveGoalStatement: (text: string) => core.patchPreparation({ preachingGoal: { ...core.preparation.preachingGoal, statement: text } }) }} />;
  const thesisFields = (core as typeof core & { thesisFields?: Record<string, PreparationTextBinding> }).thesisFields;
  const thesis = core.preparation.thesis;
  const thesisProps: Record<string, unknown> = { fields: thesisFields };
  for (const name of ['exegetical', 'homiletical', 'questionWord', 'pluralKey', 'transitionSentence', 'oneSentence', 'sermonInOneSentence', 'whyPreach', 'impactOnChurch', 'practicalQuestions']) {
    const answer = ['whyPreach', 'impactOnChurch', 'practicalQuestions'].includes(name);
    thesisProps[name] = answer ? thesis?.homileticalAnswers?.[name as 'whyPreach'] : thesis?.[name as 'exegetical'];
    thesisProps['onSave' + name[0].toUpperCase() + name.slice(1)] = (text: string) => core.patchPreparation({ thesis: answer ? { ...thesis, homileticalAnswers: { ...thesis?.homileticalAnswers, [name]: text } } : { ...thesis, [name]: text } });
  }
  return <>{withStatus && <>
    <DataSyncStatus subject={core.syncSubject ?? core.recoveryIdentity} status={core.status} comparison={core.syncComparison} error={core.error}
      onKeepLocal={core.keepLocal} onAcceptRemote={core.acceptRemote} onRetry={core.retry} />
    <button onClick={() => { void rawDocument.acceptRemote().catch(() => undefined); }}>Choose stored document</button>
  </>}{shown && section === 'textContext' && <TextContextStepContent {...{ initialVerse: core.coreValues.verse, onSaveVerse: (verse: string) => core.patchCore({ verse }), initialPassageSummary: core.preparation.textContext?.passageSummary, onSavePassageSummary: (passageSummary: string) => core.patchPreparation({ textContext: { passageSummary } }), initialContextNotes: core.preparation.textContext?.contextNotes, onSaveContextNotes: (contextNotes: string) => core.patchPreparation({ textContext: { contextNotes } }), initialRepeatedWords: core.preparation.textContext?.repeatedWords, onSaveRepeatedWords: (repeatedWords: string[]) => core.patchPreparation({ textContext: { repeatedWords } }), fields: (core as typeof core & { textContextFields?: Record<string, PreparationTextBinding> }).textContextFields }} />}
    {shown && section === 'authorIntent' && <ExegeticalPlanModule {...{ value: [], onEdit: () => undefined, authorIntent: core.preparation.authorIntent, onSaveAuthorIntent: (text: string) => core.patchPreparation({ authorIntent: text }), authorIntentField: (core as typeof core & { authorIntentField?: PreparationTextBinding }).authorIntentField }} />}
    {shown && section === 'homileticPlan' && <HomileticPlanStepContent {...{ initialUpdatedPlan: core.preparation.homileticPlan?.updatedPlan, initialSermonPlan: core.preparation.homileticPlan?.sermonPlan, onSaveUpdatedPlan: (updatedPlan: { id: string; title: string }[]) => core.patchPreparation({ homileticPlan: { ...core.preparation.homileticPlan, updatedPlan } }), onSaveSermonPlan: (sermonPlan: { id: string; title: string }[]) => core.patchPreparation({ homileticPlan: { ...core.preparation.homileticPlan, sermonPlan } }), planFields: (core as typeof core & { homileticPlanFields?: unknown }).homileticPlanFields, initialModernTranslation: core.preparation.homileticPlan?.modernTranslation, onSaveModernTranslation: (text: string) => core.patchPreparation({ homileticPlan: { modernTranslation: text } }), modernTranslation: (core as typeof core & { modernTranslationField?: PreparationTextBinding }).modernTranslationField }} />}
    {shown && section === 'thesis' && <ThesisStepContent {...thesisProps} />}{shown && section === 'goals' && goals}{shown && section === 'mainIdea' && <MainIdeaStepContent contextIdea={core.mainIdeaFields.contextIdea} textIdea={allFields ? core.mainIdeaFields.textIdea : undefined} />}</>;
}
async function setup(options: { beforeBrowser?: () => void; waitForReady?: boolean; withStatus?: boolean; allFields?: boolean; initialValue?: DocumentData; section?: 'mainIdea' | 'goals' | 'thesis' | 'authorIntent' | 'homileticPlan' | 'textContext' } = {}) {
  jest.mocked(useAuth).mockReturnValue({ user: { uid: 'owner' } } as never);
  const h = documentEngineHarness({ resource, value: options.initialValue ?? initial,
    metadata: { protocol: 1, generation: 'original', revision: 1, deleted: false } });
  options.beforeBrowser?.();
  const browser = h.createBrowser(); jest.mocked(createBrowserDataEngine).mockReturnValue(browser);
  const page = (shown = true) => <DataEngineProvider><DataDocumentProvider resource={resource} options={{ slot: 'sermon' }}><PageField shown={shown} withStatus={options.withStatus} allFields={options.allFields} section={options.section} /></DataDocumentProvider></DataEngineProvider>;
  const view = render(page());
  const placeholders = { textContext: 'wizard.steps.textContext.passageInput.placeholder', mainIdea: 'wizard.steps.mainIdea.contextIdea.placeholder', goals: 'wizard.steps.goals.timelessTruth.placeholder', thesis: 'wizard.steps.thesis.exegetical.placeholder', authorIntent: 'wizard.steps.exegeticalPlan.authorIntent.placeholder', homileticPlan: 'wizard.steps.homileticPlan.fields.modernTranslation.placeholder' };
  const input = await screen.findByPlaceholderText(placeholders[options.section ?? 'mainIdea']);
  if (options.waitForReady !== false) await waitFor(() => expect(input).toBeEnabled());
  return { h, view, input, page };
}
async function finish(view: { unmount(): void }) { view.unmount(); await act(settleEngine); }
const contextIdea = (h: ReturnType<typeof documentEngineHarness>) =>
  (h.server.value?.preparation as typeof initial.preparation).mainIdea.contextIdea;

it('carries the selected passage and its observed revision from the Preparation Save', async () => {
  const t = await setup({ section: 'textContext' });
  try {
    fireEvent.change(t.input, { target: { value: 'John 4:1' } });
    expect(t.h.transport.send).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTitle('actions.save'));
    await waitFor(() => expect(t.h.transport.send).toHaveBeenCalledWith(expect.objectContaining({
      sermonVerseAction: expect.objectContaining({ observedRevision: 1 }),
      changes: expect.arrayContaining([{ path: ['verse'], before: { exists: true, value: 'John 3:16' },
        after: { exists: true, value: 'John 4:1' } }]),
    })));
  } finally { await finish(t.view); }
});

it('keeps the later saved field until an earlier unsent draft is explicitly compared with it', async () => {
  const t = await setup();
  try {
    fireEvent.change(t.input, { target: { value: 'Earlier desktop draft' } });
    expect(t.h.transport.send).not.toHaveBeenCalled();
    await act(async () => { await t.h.remote({ preparation: { mainIdea: { contextIdea: 'Later phone words', textIdea: 'Sibling words' } } }); });
    expect(t.input).toHaveValue('Earlier desktop draft');
    expect(contextIdea(t.h)).toBe('Later phone words');
    fireEvent.click(screen.getByTitle('actions.save'));
    await waitFor(() => expect(t.h.transport.send).toHaveBeenCalled());
    await act(async () => { await t.h.engine.retry(); await settleEngine(); });
    expect(contextIdea(t.h)).toBe('Later phone words');
  } finally { await finish(t.view); }
});

it('follows a later stored field while the person has not typed', async () => {
  const t = await setup();
  try {
    await act(async () => { await t.h.remote({ preparation: { mainIdea: { contextIdea: 'Later phone words', textIdea: 'Sibling words' } } }); });
    expect(t.input).toHaveValue('Later phone words');
    expect(screen.queryByTitle('actions.save')).not.toBeInTheDocument();
    expect(t.h.transport.send).not.toHaveBeenCalled();
  } finally { await finish(t.view); }
});

it('still saves an ordinary field edit and preserves its sibling', async () => {
  const t = await setup();
  try {
    fireEvent.change(t.input, { target: { value: 'Ordinary saved words' } });
    fireEvent.click(screen.getByTitle('actions.save'));
    await waitFor(() => expect(contextIdea(t.h)).toBe('Ordinary saved words'));
    expect((t.h.server.value?.preparation as typeof initial.preparation).mainIdea.textIdea).toBe('Sibling words');
  } finally { await finish(t.view); }
});


it('keeps later typing when the step is folded during a held Save', async () => {
  const t = await setup(); let release!: () => void, entered!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  const started = new Promise<void>(resolve => { entered = resolve; });
  try {
    fireEvent.change(t.input, { target: { value: 'First saved words' } });
    const create = t.h.commits.create.bind(t.h.commits);
    jest.spyOn(t.h.commits, 'create').mockImplementationOnce(async record => { entered(); await held; return create(record); });
    fireEvent.click(screen.getByTitle('actions.save')); await act(async () => { await started; });
    expect(t.input).toBeEnabled();
    fireEvent.change(t.input, { target: { value: 'First plus later words' } });
    t.view.rerender(t.page(false));
    await act(async () => { release(); await settleEngine(); await t.h.engine.retry(); await settleEngine(); });
    expect(contextIdea(t.h)).toBe('First saved words');
    t.view.rerender(t.page());
    const input = await screen.findByDisplayValue('First plus later words'); expect(input).toBeEnabled();
    fireEvent.click(screen.getByTitle('actions.save'));
    await waitFor(() => expect(contextIdea(t.h)).toBe('First plus later words'));
  } finally { release?.(); jest.restoreAllMocks(); await finish(t.view); }
});

it('offers the last typed words after immediate page retirement and explicit recovery', async () => {
  const t = await setup(); let reopened: ReturnType<typeof render> | undefined;
  try {
    fireEvent.change(t.input, { target: { value: 'Last words before leaving' } });
    t.view.unmount(); await act(settleEngine);
    jest.mocked(createBrowserDataEngine).mockReturnValue(t.h.createBrowser());
    reopened = render(t.page());
    const choice = await screen.findByLabelText('dataSync.recoveryLabel');
    const option = (choice as HTMLSelectElement).options[1]; expect(option).toBeDefined();
    fireEvent.change(choice, { target: { value: option.value } });
    expect(await screen.findByText('Last words before leaving')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'dataSync.recover' }));
    const input = await screen.findByDisplayValue('Last words before leaving');
    await waitFor(() => expect(input).toBeEnabled());
    expect(t.h.transport.send).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTitle('actions.save'));
    await waitFor(() => expect(contextIdea(t.h)).toBe('Last words before leaving'));
  } finally { reopened?.unmount(); await finish(t.view); }
});


it('keeps the first accepted keystrokes when opening storage was slow and the page is left immediately', async () => {
  let release!: () => void, entered!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  const started = new Promise<void>(resolve => { entered = resolve; });
  let store!: ReturnType<typeof manualStores.createIndexedDbManualScopes>;
  const t = await setup({ waitForReady: false, beforeBrowser: () => {
    store = manualStores.createIndexedDbManualScopes();
    jest.mocked(manualStores.createIndexedDbManualScopes).mockReturnValueOnce(store);
    const create = store.create.bind(store);
    jest.spyOn(store, 'create').mockImplementationOnce(async record => { entered(); await held; return create(record); });
  } });
  try {
    await act(async () => { await started; }); expect(t.input).toBeDisabled();
    expect(t.h.transport.send).not.toHaveBeenCalled();
    await act(async () => { release(); await settleEngine(); });
    await waitFor(() => expect(t.input).toBeEnabled());
    fireEvent.change(t.input, { target: { value: 'First accepted words' } });
    t.view.unmount(); await act(settleEngine);
    const records = await store.list('owner', resource);
    expect(records).toEqual(expect.arrayContaining([expect.objectContaining({
      record: expect.objectContaining({ stage: [{ exists: true, value: 'First accepted words' }] }) })]));
    expect(t.h.transport.send).not.toHaveBeenCalled();
  } finally { release?.(); jest.restoreAllMocks(); await finish(t.view); }
});


it('explains a failed field opening and offers a working retry', async () => {
  const t = await setup({ waitForReady: false, beforeBrowser: () => {
    const store = manualStores.createIndexedDbManualScopes();
    jest.mocked(manualStores.createIndexedDbManualScopes).mockReturnValueOnce(store);
    jest.spyOn(store, 'create').mockRejectedValueOnce(new Error('Manual opening disk full'));
  } });
  try {
    expect(await screen.findByRole('alert')).toBeInTheDocument(); expect(t.input).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'dataSync.retry' }));
    await waitFor(() => expect(t.input).toBeEnabled());
    fireEvent.change(t.input, { target: { value: 'Words after opening retry' } });
    fireEvent.click(screen.getByTitle('actions.save'));
    await waitFor(() => expect(contextIdea(t.h)).toBe('Words after opening retry'));
  } finally { jest.restoreAllMocks(); await finish(t.view); }
});


it('routes the one header choice to later field words after the document choice retired their ancestor', async () => {
  const t = await setup({ withStatus: true }); let release!: () => void, entered!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  const started = new Promise<void>(resolve => { entered = resolve; });
  try {
    fireEvent.change(t.input, { target: { value: 'First saved words' } });
    const create = t.h.commits.create.bind(t.h.commits);
    jest.spyOn(t.h.commits, 'create').mockImplementationOnce(async record => { entered(); await held; return create(record); });
    fireEvent.click(screen.getByTitle('actions.save')); await act(async () => { await started; });
    fireEvent.change(t.input, { target: { value: 'Later unsent words' } });
    t.h.silentRemote({ preparation: { mainIdea: { contextIdea: 'Phone words', textIdea: 'Sibling words' } } });
    await act(async () => { release(); await settleEngine(); await t.h.engine.retry(); await settleEngine(); });
    expect(await screen.findByRole('button', { name: 'freshness.conflictKeepMine' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Choose stored document' }));
    await waitFor(() => expect(contextIdea(t.h)).toBe('Phone words'));
    await act(settleEngine);
    const keep = await screen.findByRole('button', { name: 'freshness.conflictKeepMine' });
    expect(screen.getAllByRole('button', { name: 'freshness.conflictKeepMine' })).toHaveLength(1);
    expect(t.input).toHaveValue('Later unsent words');
    fireEvent.click(keep);
    await waitFor(() => expect(contextIdea(t.h)).toBe('Later unsent words'));
  } finally { release?.(); jest.restoreAllMocks(); await finish(t.view); }
});


it('saves its changed field over a newer sibling revision without asking for a conflict', async () => {
  const t = await setup({ withStatus: true });
  try {
    await act(async () => { await t.h.remote({ preparation: { mainIdea: { contextIdea: 'Opening preparation words', textIdea: 'New sibling words' } } }); });
    fireEvent.change(t.input, { target: { value: 'Current context idea' } });
    fireEvent.click(screen.getByTitle('actions.save'));
    await waitFor(() => expect(contextIdea(t.h)).toBe('Current context idea'));
    await act(settleEngine);
    expect((t.h.server.value?.preparation as typeof initial.preparation).mainIdea.textIdea).toBe('New sibling words');
    expect(screen.queryByRole('button', { name: 'freshness.conflictKeepMine' })).not.toBeInTheDocument();
  } finally { await finish(t.view); }
});


it('saves the first field when a sibling created its formerly absent preparation container', async () => {
  const naked: DocumentData = { ...initial }; delete naked.preparation;
  const t = await setup({ withStatus: true, initialValue: naked });
  try {
    await act(async () => { await t.h.remote({ preparation: { mainIdea: { textIdea: 'First sibling idea' } } }); });
    expect(t.input).toHaveValue('');
    fireEvent.change(t.input, { target: { value: 'New context after sibling' } });
    fireEvent.click(screen.getByTitle('actions.save'));
    await waitFor(() => expect((t.h.server.value?.preparation as typeof initial.preparation).mainIdea.contextIdea).toBe('New context after sibling'));
    expect((t.h.server.value?.preparation as typeof initial.preparation).mainIdea.textIdea).toBe('First sibling idea');
    expect(screen.queryByRole('button', { name: 'freshness.conflictKeepMine' })).not.toBeInTheDocument();
  } finally { await finish(t.view); }
});


it('delivers two sequential offline field Saves when the first creates their preparation container', async () => {
  const naked: DocumentData = { ...initial }; delete naked.preparation;
  const t = await setup({ withStatus: true, allFields: true, initialValue: naked });
  try {
    const sibling = await screen.findByPlaceholderText('wizard.steps.mainIdea.textIdea.placeholder');
    await waitFor(() => expect(sibling).toBeEnabled());
    t.h.engine.setOnline(false);
    fireEvent.change(sibling, { target: { value: 'Offline sibling idea' } });
    fireEvent.click(screen.getByTitle('actions.save'));
    await waitFor(() => expect(screen.queryByTitle('actions.save')).not.toBeInTheDocument());
    fireEvent.change(t.input, { target: { value: 'Offline context idea' } });
    fireEvent.click(screen.getByTitle('actions.save'));
    await waitFor(() => expect(screen.queryByTitle('actions.save')).not.toBeInTheDocument());
    expect(t.h.transport.send).not.toHaveBeenCalled();
    await act(async () => { t.h.engine.setOnline(true); await t.h.engine.retry(); await settleEngine(); });
    await waitFor(() => expect((t.h.server.value?.preparation as typeof initial.preparation)?.mainIdea).toEqual({ textIdea: 'Offline sibling idea', contextIdea: 'Offline context idea' }));
    expect(screen.queryByRole('button', { name: 'freshness.conflictKeepMine' })).not.toBeInTheDocument();
  } finally { await finish(t.view); }
});


it.each([false, true])('keeps neighboring offline Saves while the first capture is held, page closed: %s', async closePage => {
  const naked: DocumentData = { ...initial }; delete naked.preparation;
  const t = await setup({ withStatus: true, allFields: true, initialValue: naked });
  let reopened: ReturnType<typeof render> | undefined;
  let release!: () => void, entered!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  const started = new Promise<void>(resolve => { entered = resolve; });
  try {
    const sibling = await screen.findByPlaceholderText('wizard.steps.mainIdea.textIdea.placeholder');
    await waitFor(() => expect(sibling).toBeEnabled());
    t.h.engine.setOnline(false);
    const create = t.h.commits.create.bind(t.h.commits);
    jest.spyOn(t.h.commits, 'create').mockImplementationOnce(async record => { entered(); await held; return create(record); });
    fireEvent.change(sibling, { target: { value: 'Held sibling idea' } });
    fireEvent.click(screen.getByTitle('actions.save'));
    await act(async () => { await started; });
    fireEvent.change(t.input, { target: { value: 'Following context idea' } });
    const save = screen.getAllByTitle('actions.save').find(button => !(button as HTMLButtonElement).disabled);
    expect(save).toBeDefined(); fireEvent.click(save!);
    if (closePage) t.view.unmount();
    await act(async () => { release(); await settleEngine(); });
    expect(t.h.transport.send).not.toHaveBeenCalled();
    if (closePage) {
      jest.mocked(createBrowserDataEngine).mockReturnValue(t.h.createBrowser());
      reopened = render(t.page());
    }
    await act(async () => { t.h.engine.setOnline(true); await t.h.engine.retry(); await settleEngine(); });
    try {
    await waitFor(() => expect((t.h.server.value?.preparation as typeof initial.preparation)?.mainIdea).toEqual({
      textIdea: 'Held sibling idea', contextIdea: 'Following context idea' }));
    } catch {
      throw new Error('Held Save boundary state: ' + JSON.stringify({ server: t.h.server, requests: await t.h.commits.list('owner'),
        forms: await manualStores.createIndexedDbManualScopes().list('owner', resource) }));
    }
  } finally { release?.(); reopened?.unmount(); jest.restoreAllMocks(); await finish(t.view); }
});


it('shows the exact field words and stored version together after a refused field Save', async () => {
  const t = await setup({ withStatus: true });
  try {
    fireEvent.change(t.input, { target: { value: 'Earlier field words' } });
    await act(async () => { await t.h.remote({ preparation: { mainIdea: { contextIdea: 'Later stored field words', textIdea: 'Sibling words' } } }); });
    fireEvent.click(screen.getByTitle('actions.save'));
    await screen.findByRole('button', { name: 'freshness.conflictKeepMine' });
    const comparison = await screen.findByRole('region', { name: 'dataSync.versionComparison' });
    expect(within(comparison).getByText('Earlier field words')).toBeInTheDocument();
    expect(within(comparison).getByText('Later stored field words')).toBeInTheDocument();
    expect(within(comparison).getByRole('button', { name: 'freshness.conflictKeepMine' })).toBeInTheDocument();
    expect(screen.getAllByRole('region', { name: 'dataSync.versionComparison' })).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: 'freshness.conflictKeepMine' })).toHaveLength(1);
    expect(t.input).toHaveValue('Earlier field words');
    expect(contextIdea(t.h)).toBe('Later stored field words');
  } finally { await finish(t.view); }
});

it('does not compare an untouched field when only its sibling changes', async () => {
  const t = await setup({ withStatus: true, allFields: true });
  try {
    await act(async () => { await t.h.remote({ preparation: { mainIdea: { contextIdea: 'Opening preparation words', textIdea: 'Later sibling words' } } }); });
    expect(t.input).toHaveValue('Opening preparation words');
    expect(screen.queryByRole('region', { name: 'dataSync.versionComparison' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'freshness.conflictKeepMine' })).not.toBeInTheDocument();
  } finally { await finish(t.view); }
});


it('keeps the one field comparison available in the header when its preparation step folds', async () => {
  const t = await setup({ withStatus: true });
  try {
    fireEvent.change(t.input, { target: { value: 'Field words before folding' } });
    await act(async () => { await t.h.remote({ preparation: { mainIdea: { contextIdea: 'Stored words before folding', textIdea: 'Sibling words' } } }); });
    fireEvent.click(screen.getByTitle('actions.save')); await screen.findByRole('button', { name: 'freshness.conflictKeepMine' });
    await screen.findByRole('region', { name: 'dataSync.versionComparison' });
    t.view.rerender(t.page(false));
    const comparison = await screen.findByRole('region', { name: 'dataSync.versionComparison' });
    expect(within(comparison).getByText('Field words before folding')).toBeInTheDocument();
    expect(within(comparison).getByText('Stored words before folding')).toBeInTheDocument();
    expect(within(comparison).getByRole('button', { name: 'freshness.conflictKeepMine' })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'freshness.conflictKeepMine' })).toHaveLength(1);
  } finally { await finish(t.view); }
});


it.each(['keep', 'stored', 'cancel'] as const)('uses the latest staged words for the explicit %s field decision', async choice => {
  const t = await setup({ withStatus: true });
  try {
    fireEvent.change(t.input, { target: { value: 'Earlier field words' } });
    await act(async () => { await t.h.remote({ preparation: { mainIdea: { contextIdea: 'Later stored field words', textIdea: 'Sibling words' } } }); });
    fireEvent.click(screen.getByTitle('actions.save'));
    await screen.findByRole('button', { name: 'freshness.conflictKeepMine' });
    fireEvent.change(t.input, { target: { value: 'Latest unsent field words' } });
    await waitFor(() => expect(screen.getByRole('region', { name: 'dataSync.versionComparison' })).toHaveTextContent('Latest unsent field words'));
    if (choice === 'keep') {
      fireEvent.click(screen.getByRole('button', { name: 'freshness.conflictKeepMine' }));
      await waitFor(() => expect(contextIdea(t.h)).toBe('Latest unsent field words'));
    } else {
      fireEvent.click(screen.getByRole('button', { name: 'dataSync.useStoredVersion' }));
      const dialog = await screen.findByRole('dialog');
      expect(contextIdea(t.h)).toBe('Later stored field words');
      expect(t.input).toHaveValue('Latest unsent field words');
      fireEvent.click(within(dialog).getByRole('button', { name: choice === 'stored' ? 'common.discardText.confirm' : 'common.discardText.keep' }));
      if (choice === 'stored') {
        await waitFor(() => expect(t.input).toHaveValue('Later stored field words'));
        await waitFor(() => expect(screen.queryByRole('region', { name: 'dataSync.versionComparison' })).not.toBeInTheDocument());
      } else {
        await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
        expect(t.input).toHaveValue('Latest unsent field words');
        expect(screen.getByRole('region', { name: 'dataSync.versionComparison' })).toBeInTheDocument();
      }
      expect(contextIdea(t.h)).toBe('Later stored field words');
    }
    expect((t.h.server.value?.preparation as typeof initial.preparation).mainIdea.textIdea).toBe('Sibling words');
  } finally { await finish(t.view); }
});


it.each([
  ['timelessTruth', 'wizard.steps.goals.timelessTruth.placeholder'],
  ['christConnection', 'wizard.steps.goals.christConnection.placeholder'],
  ['statement', 'wizard.steps.goals.goal.placeholder'],
])('does not silently overwrite the later stored goal field %s', async (field, placeholder) => {
  const opening = { timelessTruth: 'Opening truth', christConnection: 'Opening connection', preachingGoal: { statement: 'Opening statement' } };
  const t = await setup({ section: 'goals', withStatus: true, initialValue: { ...initial, preparation: { ...initial.preparation, ...opening } } });
  const input = screen.getByPlaceholderText(placeholder);
  const stored = () => field === 'statement' ? (t.h.server.value?.preparation as typeof opening).preachingGoal.statement : (t.h.server.value?.preparation as Record<string, unknown>)[field];
  try {
    await waitFor(() => expect(input).toBeEnabled());
    fireEvent.change(input, { target: { value: 'Earlier goal draft' } });
    const later = field === 'statement' ? { ...opening, preachingGoal: { statement: 'Later goal words' } } : { ...opening, [field]: 'Later goal words' };
    await act(async () => { await t.h.remote({ preparation: { ...initial.preparation, ...later } }); });
    fireEvent.click(screen.getByTitle('actions.save'));
    await waitFor(() => expect(t.h.transport.send).toHaveBeenCalled());
    await act(async () => { await t.h.engine.retry(); await settleEngine(); });
    expect(stored()).toBe('Later goal words');
    expect(input).toHaveValue('Earlier goal draft');
    const comparison = await screen.findByRole('region', { name: 'dataSync.versionComparison' });
    expect(comparison).toHaveTextContent('Earlier goal draft');
    expect(comparison).toHaveTextContent('Later goal words');
  } finally { await finish(t.view); }
});


it('keeps staged words when the compared stored copy changes during discard confirmation', async () => {
  const t = await setup({ withStatus: true });
  try {
    fireEvent.change(t.input, { target: { value: 'My current field words' } });
    await act(async () => { await t.h.remote({ preparation: { mainIdea: { contextIdea: 'Stored version B', textIdea: 'Sibling words' } } }); });
    fireEvent.click(screen.getByTitle('actions.save'));
    fireEvent.click(await screen.findByRole('button', { name: 'dataSync.useStoredVersion' }));
    const dialog = await screen.findByRole('dialog');
    const confirm = within(dialog).getByRole('button', { name: 'common.discardText.confirm' });
    await act(async () => { await t.h.remote({ preparation: { mainIdea: { contextIdea: 'Stored version C', textIdea: 'Sibling words' } } }); });
    if (confirm.isConnected) fireEvent.click(confirm);
    await act(settleEngine);
    expect(t.input).toHaveValue('My current field words');
    expect(contextIdea(t.h)).toBe('Stored version C');
    expect(screen.getByRole('region', { name: 'dataSync.versionComparison' })).toHaveTextContent('Stored version C');
  } finally { await finish(t.view); }
});


it.each([
  ['exegetical', 'exegetical.placeholder'], ['homiletical', 'homiletical.ownPh'],
  ['questionWord', 'oneSentence.questionPh'], ['pluralKey', 'oneSentence.pluralKeyPh'],
  ['transitionSentence', 'oneSentence.transitionPh'], ['oneSentence', 'oneSentence.onePh'],
  ['sermonInOneSentence', 'oneSentence.sermonPh'], ['whyPreach', 'homiletical.q.whyPh'],
  ['impactOnChurch', 'homiletical.q.impactPh'], ['practicalQuestions', 'homiletical.q.practicalPh'],
])('does not silently overwrite the later stored thesis field %s', async (field, placeholder) => {
  const answer = ['whyPreach', 'impactOnChurch', 'practicalQuestions'].includes(field);
  const opening = { exegetical: 'Opening thesis', homileticalAnswers: { whyPreach: 'Opening why', impactOnChurch: 'Opening impact', practicalQuestions: 'Opening questions' } };
  const t = await setup({ section: 'thesis', withStatus: true, initialValue: { ...initial, preparation: { ...initial.preparation, thesis: opening } } });
  try {
    const input = screen.getByPlaceholderText('wizard.steps.thesis.' + placeholder);
    await waitFor(() => expect(input).toBeEnabled());
    fireEvent.change(input, { target: { value: 'Earlier thesis draft' } });
    const later = answer ? { ...opening, homileticalAnswers: { ...opening.homileticalAnswers, [field]: 'Later thesis words' } } : { ...opening, [field]: 'Later thesis words' };
    await act(async () => { await t.h.remote({ preparation: { ...initial.preparation, thesis: later } }); });
    fireEvent.click(screen.getByTitle('actions.save'));
    await waitFor(() => expect(t.h.transport.send).toHaveBeenCalled());
    await act(async () => { await t.h.engine.retry(); await settleEngine(); });
    const stored = (t.h.server.value?.preparation as { thesis: Record<string, unknown> }).thesis;
    expect(answer ? (stored.homileticalAnswers as Record<string, unknown>)[field] : stored[field]).toBe('Later thesis words');
    expect(input).toHaveValue('Earlier thesis draft');
    expect(await screen.findByRole('region', { name: 'dataSync.versionComparison' })).toHaveTextContent('Later thesis words');
  } finally { await finish(t.view); }
});


it.each(['authorIntent', 'homileticPlan'] as const)('does not silently overwrite the later stored %s text', async section => {
  const opening = { authorIntent: 'Opening author intent', homileticPlan: { modernTranslation: 'Opening modern translation' } };
  const t = await setup({ section, withStatus: true, initialValue: { ...initial, preparation: { ...initial.preparation, ...opening } } });
  try {
    fireEvent.change(t.input, { target: { value: 'Earlier preparation draft' } });
    const later = section === 'authorIntent' ? { ...opening, authorIntent: 'Later preparation words' } : { ...opening, homileticPlan: { modernTranslation: 'Later preparation words' } };
    await act(async () => { await t.h.remote({ preparation: { ...initial.preparation, ...later } }); });
    fireEvent.click(screen.getByTitle(section === 'homileticPlan' ? 'homiletic.actions.save' : 'actions.save'));
    await waitFor(() => expect(t.h.transport.send).toHaveBeenCalled());
    await act(async () => { await t.h.engine.retry(); await settleEngine(); });
    const stored = t.h.server.value?.preparation as typeof opening;
    expect(section === 'authorIntent' ? stored.authorIntent : stored.homileticPlan.modernTranslation).toBe('Later preparation words');
    expect(t.input).toHaveValue('Earlier preparation draft');
    expect(await screen.findByRole('region', { name: 'dataSync.versionComparison' })).toHaveTextContent('Later preparation words');
  } finally { await finish(t.view); }
});


it.each([
  ['verse', 'passageInput.placeholder'], ['passageSummary', 'passageSummary.placeholder'],
  ['contextNotes', 'contextInput.placeholder'], ['repeatedWords', 'repeatedInput.placeholder'],
])('does not silently overwrite the later stored text-context field %s', async (field, placeholder) => {
  const opening = { passageSummary: 'Opening summary', contextNotes: 'Opening context', repeatedWords: ['Opening words'] };
  const t = await setup({ section: 'textContext', withStatus: true, initialValue: { ...initial, preparation: { ...initial.preparation, textContext: opening } } });
  try {
    const input = screen.getByPlaceholderText('wizard.steps.textContext.' + placeholder);
    await waitFor(() => expect(input).toBeEnabled());
    fireEvent.change(input, { target: { value: 'Earlier text draft' } });
    const laterValue = field === 'repeatedWords' ? ['Later text words'] : 'Later text words';
    await act(async () => { await t.h.remote(field === 'verse' ? { verse: laterValue } : { preparation: { ...initial.preparation, textContext: { ...opening, [field]: laterValue } } }); });
    fireEvent.click(screen.getByTitle('actions.save'));
    await waitFor(() => expect(t.h.transport.send).toHaveBeenCalled());
    await act(async () => { await t.h.engine.retry(); await settleEngine(); });
    const stored = field === 'verse' ? t.h.server.value?.verse : (t.h.server.value?.preparation as { textContext: Record<string, unknown> }).textContext[field];
    expect(stored).toEqual(field === 'repeatedWords' ? ['Later text words', 'Earlier text draft'] : laterValue);
    expect(input).toHaveValue(field === 'repeatedWords' ? 'Later text words, Earlier text draft' : 'Earlier text draft');
  } finally { await finish(t.view); }
});

it('does not silently overwrite a later stored goal type', async () => {
  const t = await setup({ section: 'goals', withStatus: true, initialValue: { ...initial, preparation: { preachingGoal: { type: 'informative' } } } });
  try {
    const input = screen.getByLabelText('wizard.steps.goals.goal.typeLabel');
    await waitFor(() => expect(input).toBeEnabled());
    fireEvent.change(input, { target: { value: 'didactic' } });
    await act(async () => { await t.h.remote({ preparation: { preachingGoal: { type: 'proclamation' } } }); });
    fireEvent.click(screen.getByTitle('actions.save'));
    await waitFor(() => expect(t.h.transport.send).toHaveBeenCalled());
    await act(async () => { await t.h.engine.retry(); await settleEngine(); });
    expect((t.h.server.value?.preparation as { preachingGoal: { type: string } }).preachingGoal.type).toBe('proclamation');
    expect(input).toHaveValue('didactic');
  } finally { await finish(t.view); }
});

it.each(['updatedPlan', 'sermonPlan'] as const)('does not silently overwrite later stored %s points', async field => {
  const opening = { modernTranslation: 'Modern words', [field]: [{ id: 'stable-point', title: 'Opening point' }] };
  const t = await setup({ section: 'homileticPlan', withStatus: true, initialValue: { ...initial, preparation: { homileticPlan: opening } } });
  try {
    const input = screen.getByLabelText('wizard.steps.homileticPlan.fields.' + field + '.itemLabel');
    await waitFor(() => expect(input).toBeEnabled());
    fireEvent.change(input, { target: { value: 'Earlier point draft' } });
    const later = [{ id: 'stable-point', title: 'Later point words' }];
    await act(async () => { await t.h.remote({ preparation: { homileticPlan: { ...opening, [field]: later } } }); });
    fireEvent.click(screen.getByTitle('actions.save'));
    await waitFor(() => expect(t.h.transport.send).toHaveBeenCalled());
    await act(async () => { await t.h.engine.retry(); await settleEngine(); });
    expect((t.h.server.value?.preparation as { homileticPlan: Record<string, unknown> }).homileticPlan[field]).toEqual(later);
    expect(input).toHaveValue('Earlier point draft');
  } finally { await finish(t.view); }
});


const normalizedCases = [
  { section: 'textContext', placeholder: 'wizard.steps.textContext.passageInput.placeholder', path: ['verse'], raw: '  Romans 8:14  ', expected: 'Romans 8:14' },
  { section: 'textContext', placeholder: 'wizard.steps.textContext.passageSummary.placeholder', path: ['preparation', 'textContext', 'passageSummary'], raw: '  My summary  ', expected: 'My summary' },
  { section: 'textContext', placeholder: 'wizard.steps.textContext.repeatedInput.placeholder', path: ['preparation', 'textContext', 'repeatedWords'], raw: 'a,b , , c', expected: ['a', 'b', 'c'] },
  { section: 'homileticPlan', placeholder: 'wizard.steps.homileticPlan.fields.updatedPlan.itemPlaceholder', path: ['preparation', 'homileticPlan', 'updatedPlan'], raw: '  My updated point  ', expected: [{ id: 'point-u', title: 'My updated point' }] },
  { section: 'homileticPlan', placeholder: 'wizard.steps.homileticPlan.fields.sermonPlan.itemPlaceholder', path: ['preparation', 'homileticPlan', 'sermonPlan'], raw: '  My sermon point  ', expected: [{ id: 'point-s', title: 'My sermon point' }] },
] as const;
const normalizationOpening = { ...initial, preparation: { ...initial.preparation,
  textContext: { passageSummary: 'Opening summary', repeatedWords: ['old'] },
  homileticPlan: { modernTranslation: 'Modern words', updatedPlan: [{ id: 'point-u', title: 'Updated point' }], sermonPlan: [{ id: 'point-s', title: 'Sermon point' }] } } };
function selectedValue(document: unknown, path: readonly string[]): unknown {
  return path.reduce<unknown>((value, key) => (value as Record<string, unknown> | undefined)?.[key], document);
}

it.each(normalizedCases)('normalizes only the explicit Save of $placeholder, online and after offline capture', async field => {
  const t = await setup({ section: field.section, initialValue: normalizationOpening });
  try {
    const input = screen.getByPlaceholderText(field.placeholder);
    await waitFor(() => expect(input).toBeEnabled());
    t.h.engine.setOnline(false);
    fireEvent.change(input, { target: { value: field.raw } });
    expect(input).toHaveValue(field.raw);
    expect(t.h.transport.send).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTitle('actions.save'));
    await waitFor(async () => {
      const requests = await t.h.commits.list('owner');
      expect(requests.some(request => JSON.stringify(selectedValue(request.value, field.path)) === JSON.stringify(field.expected))).toBe(true);
    });
    expect(selectedValue(t.h.server.value, field.path)).toEqual(selectedValue(normalizationOpening, field.path));
    await act(async () => { t.h.engine.setOnline(true); await t.h.engine.retry(); await settleEngine(); });
    await waitFor(() => expect(selectedValue(t.h.server.value, field.path)).toEqual(field.expected));
    if (field.section === 'homileticPlan') expect(input).toHaveValue(field.expected[0].title);
    else expect(input).toHaveValue(typeof field.expected === 'string' ? field.expected : field.expected.join(', '));
  } finally { await finish(t.view); }
});

it.each(normalizedCases.filter(field => field.path.at(-1) !== 'repeatedWords'))('normalizes the explicit Keep local decision for $placeholder', async field => {
  const t = await setup({ section: field.section, withStatus: true, initialValue: normalizationOpening });
  try {
    const input = screen.getByPlaceholderText(field.placeholder);
    await waitFor(() => expect(input).toBeEnabled());
    fireEvent.change(input, { target: { value: 'Earlier draft' } });
    const remote = JSON.parse(JSON.stringify(normalizationOpening)) as DocumentData;
    if (field.path[0] === 'verse') remote.verse = 'Later stored words';
    else if (field.section === 'textContext') (remote.preparation as DocumentData).textContext = { passageSummary: 'Later stored words', repeatedWords: ['old'] };
    else ((remote.preparation as DocumentData).homileticPlan as DocumentData)[field.path.at(-1)!] = [{ id: field.expected[0].id, title: 'Later stored words' }];
    await act(async () => { await t.h.remote(remote); });
    fireEvent.click(screen.getByTitle('actions.save'));
    await screen.findByRole('button', { name: 'freshness.conflictKeepMine' });
    fireEvent.change(input, { target: { value: field.raw } });
    await waitFor(() => expect(screen.getByRole('region', { name: 'dataSync.versionComparison' })).toHaveTextContent(field.raw.trim()));
    fireEvent.click(screen.getByRole('button', { name: 'freshness.conflictKeepMine' }));
    await waitFor(() => expect(selectedValue(t.h.server.value, field.path)).toEqual(field.expected));
  } finally { await finish(t.view); }
});


it('does not open preparation stages while their controls have never been shown', async () => {
  jest.mocked(useAuth).mockReturnValue({ user: { uid: 'owner' } } as never);
  const h = documentEngineHarness({ resource, value: initial, metadata: { protocol: 1, generation: 'original', revision: 1, deleted: false } });
  const browser = h.createBrowser(); jest.mocked(createBrowserDataEngine).mockReturnValue(browser);
  const view = render(<DataEngineProvider><DataDocumentProvider resource={resource}><PageField shown={false} /></DataDocumentProvider></DataEngineProvider>);
  try {
    await act(settleEngine);
    const stages = await manualStores.createIndexedDbManualScopes().list('owner', resource);
    expect(stages).toEqual([]);
    expect(h.transport.send).not.toHaveBeenCalled();
  } finally { await finish(view); }
});

function PendingPreparationPage() {
  const core = useSermonCoreDataDocument(resource.id);
  // Match the actual page's outer gate as well as the field's own manual-form readiness.
  return <fieldset disabled={core.isReadOnly}><AuthorIntentField binding={core.authorIntentField} /></fieldset>;
}

it('unlocks the rendered preparation fieldset for a pending-created sermon and saves after its create', async () => {
  jest.mocked(useAuth).mockReturnValue({ user: { uid: 'owner' } } as never);
  const h = documentEngineHarness({ resource, value: null, metadata: null });
  const browser = h.createBrowser(); browser.engine.setOnline(false); browser.engine.setOwner('owner');
  const creator = await browser.engine.createEditor(resource, 'pending-preparation-creation');
  await creator.commit(() => initial); await creator.close({ flush: false });
  jest.mocked(createBrowserDataEngine).mockReturnValue(browser);
  const view = render(<DataEngineProvider><DataDocumentProvider resource={resource} options={{ slot: 'sermon', readOnlyCopy: true }}><PendingPreparationPage /></DataDocumentProvider></DataEngineProvider>);
  try {
    const input = await screen.findByPlaceholderText('wizard.steps.exegeticalPlan.authorIntent.placeholder');
    await waitFor(() => expect(input).toBeEnabled());
    expect(h.server.value).toBeNull(); expect(h.transport.send).not.toHaveBeenCalled();
    fireEvent.change(input, { target: { value: 'Actual page preparation while creation waits' } });
    fireEvent.click(screen.getByTitle('actions.save'));
    await waitFor(async () => expect((await h.commits.list('owner')).some(request => (request.value?.preparation as DocumentData)?.authorIntent === 'Actual page preparation while creation waits')).toBe(true));
    await act(async () => { browser.engine.setOnline(true); await browser.engine.retry(); await settleEngine(); });
    expect(h.server.value?.preparation).toMatchObject({ authorIntent: 'Actual page preparation while creation waits' });
  } finally { await finish(view); }
});
