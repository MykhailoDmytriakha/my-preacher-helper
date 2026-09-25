'use client';

import { useEffect, useRef, useState } from 'react';
import { createIndexedDbCheckpoints } from '@/data-engine/checkpoint.client';
import { createIndexedDbCommitStore } from '@/data-engine/commits.client';
import { DataEngine, type ManagedEditor } from '@/data-engine/engine';
import { createIndexedDbJournal } from '@/data-engine/journal.client';
import { ResourceObserver } from '@/data-engine/observer';
import { forkCheckpoint, recoveryCheckpointId } from '@/data-engine/recovery.client';
import { DataEngineRuntime } from '@/data-engine/runtime';
import { createIndexedDbSnapshots } from '@/data-engine/snapshots.client';
import type { EditorState } from '@/data-engine/controller';
import type { EngineTransport, ResourceRef } from '@/data-engine/types';

/** Local emulator fixture only; never mount in the production application. */
export default function DataEngineBrowserFixture() {
  const [engine, setEngine] = useState<DataEngine | null>(null);
  const [editor, setEditor] = useState<ManagedEditor | null>(null);
  const [state, setState] = useState<EditorState | null>(null);
  const [error, setError] = useState('');
  const [delivery, setDelivery] = useState('[]');
  const [paused, setPaused] = useState(false);
  const [serverValue, setServerValue] = useState('');
  const pauseDelivery = useRef(false);
  const loseAck = useRef(false);
  useEffect(() => {
    const request = async (body: unknown) => {
      const response = await fetch('/api/dev-data-engine-check', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? `HTTP ${response.status}`);
      return result;
    };
    const transport: EngineTransport = { read: async (_owner, resource) => request({ action: 'read', resource }), send: command => {
      const dropResponse = loseAck.current; loseAck.current = false;
      return request({ action: 'command', command, dropResponse });
    } };
    const runtime = new DataEngineRuntime({ journal: createIndexedDbJournal(), transport });
    const observer = new ResourceObserver({ source: { listen: () => () => undefined }, transport });
    const instance = new DataEngine({ runtime, observer, transport, commits: createIndexedDbCommitStore(), checkpoints: createIndexedDbCheckpoints(), snapshots: createIndexedDbSnapshots(), operationId: () => crypto.randomUUID(), onError: failure => setError(String(failure)) });
    pauseDelivery.current = sessionStorage.getItem('fixture-pause-delivery') === 'true';
    setPaused(pauseDelivery.current);
    const online = () => instance.setOnline(navigator.onLine && !pauseDelivery.current);
    const visible = () => instance.setVisible(document.visibilityState === 'visible');
    online(); visible(); instance.setOwner('browser-integration'); setEngine(instance);
    const stopPending = instance.subscribePending(() => setDelivery(JSON.stringify(instance.getPending().map(item => item.state))));
    window.addEventListener('online', online); window.addEventListener('offline', online); document.addEventListener('visibilitychange', visible);
    return () => { stopPending(); instance.dispose(); window.removeEventListener('online', online); window.removeEventListener('offline', online); document.removeEventListener('visibilitychange', visible); };
  }, []);
  useEffect(() => {
    if (!editor) return;
    const publish = () => { setState(editor.getState()); setDelivery(JSON.stringify(editor.getDelivery().map(item => item.state))); };
    const stop = editor.subscribe(publish); publish();
    return stop;
  }, [editor]);
  const resource = (): ResourceRef => ({ collection: 'sermons', id: new URLSearchParams(location.search).get('id') || 'browser-fixture' });
  const act = (action: () => Promise<void>) => { setError(''); void action().catch(failure => setError(String(failure))); };
  const open = async (recover: boolean) => {
    if (!engine) return;
    editor?.dispose();
    const id = crypto.randomUUID(), ref = resource();
    if (recover) {
      const store = createIndexedDbCheckpoints();
      const previous = sessionStorage.getItem(`fixture-editor-${ref.id}`);
      if (!previous) throw new Error('No previous editor in this tab');
      await forkCheckpoint(store, 'browser-integration', recoveryCheckpointId('browser-integration', previous), id, ref);
    }
    setEditor(await engine.openEditor(ref, id));
    sessionStorage.setItem(`fixture-editor-${ref.id}`, id);
  };
  return <main style={{ margin: 32, maxWidth: 800, color: '#111', background: '#fff', padding: 24 }}>
    <h1>DataEngine emulator validation</h1>
    <p>Local demo database. This fixture tests real browser storage; it is not a production screen.</p>
    <button onClick={() => act(async () => {
      const response = await fetch('/api/dev-data-engine-check', { method: 'POST', body: JSON.stringify({ action: 'seed', resource: resource() }) });
      if (!response.ok) throw new Error(await response.text());
      await open(false);
    })}>Seed and open</button>{' '}
    <button onClick={() => act(() => open(false))}>Open</button>{' '}
    <button onClick={() => act(() => open(true))}>Recover local draft</button>
    {' '}<button onClick={() => { loseAck.current = true; }}>Lose next acknowledgement</button>
    {' '}<button onClick={() => {
      pauseDelivery.current = true; sessionStorage.setItem('fixture-pause-delivery', 'true');
      setPaused(true); engine?.setOnline(false);
    }}>Pause delivery</button>
    {' '}<button onClick={() => act(async () => {
      pauseDelivery.current = false; sessionStorage.removeItem('fixture-pause-delivery');
      setPaused(false); engine?.setOnline(navigator.onLine); await engine?.retry();
    })}>Resume delivery</button>
    {' '}<button onClick={() => act(async () => {
      const response = await fetch('/api/dev-data-engine-check', { method: 'POST', body: JSON.stringify({ action: 'read', resource: resource() }) });
      if (!response.ok) throw new Error(await response.text());
      setServerValue(JSON.stringify(await response.json(), null, 2));
    })}>Read server</button>
    <p>Delivery: {paused ? 'paused for test' : 'enabled'}</p>
    <pre data-testid="server-value">{serverValue}</pre>
    {state?.checkpoint.draft && <>
      <label style={{ display: 'block', marginTop: 24 }}>Title<input aria-label="Title" value={String(state.checkpoint.draft.title)} onChange={event => act(() => editor!.edit({ ...state.checkpoint.draft!, title: event.target.value }))} /></label>
      {(state.checkpoint.draft.scratch as Array<{ id: string; text: string; createdAt: string }>).map((note, index, notes) => <label key={note.id} style={{ display: 'block', marginTop: 16 }}>
        Note {note.id}<textarea aria-label={`Note ${note.id}`} style={{ display: 'block', width: '100%', minHeight: 80 }} value={note.text} onChange={event => act(() => editor!.edit({ ...state.checkpoint.draft!, scratch: notes.map((item, at) => at === index ? { ...item, text: event.target.value } : item) }))} />
      </label>)}
      <button onClick={() => act(() => editor!.save())}>Save</button>{' '}
      <button onClick={() => act(() => engine!.retry())}>Retry delivery</button>{' '}
      <button onClick={() => act(() => editor!.keepLocal())}>Keep local</button>{' '}
      <button onClick={() => act(() => editor!.acceptRemote())}>Accept remote</button>
    </>}
    <p role="alert">{error}</p>
    <pre data-testid="delivery">{delivery}</pre>
    <pre data-testid="state">{JSON.stringify(state, null, 2)}</pre>
  </main>;
}
