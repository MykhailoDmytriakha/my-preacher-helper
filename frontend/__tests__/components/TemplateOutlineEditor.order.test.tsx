import { act, fireEvent, render, screen } from '@testing-library/react';
import { createRef } from 'react';

import TemplateOutlineEditor, { type TemplateOutlineEditorHandle } from '@/components/settings/TemplateOutlineEditor';
import { createBrowserDataEngine } from '@/data-engine/browser.client';
import { manualChoiceRecoveryIdentity } from '@/data-engine/editorIdentity';
import { captureOutlinePointPlacement } from '@/data-engine/outlinePointPlacement';
import { DataEngineProvider } from '@/data-engine/react.client';
import { DataSession } from '@/data-engine/session';
import { documentEngineHarness, settleEngine } from '@test-utils/documentEngineHarness';

import type { SermonOutline } from '@/models/models';

jest.mock('@/providers/AuthProvider', () => ({ useAuth: () => ({ user: { uid: 'u1' } }) }));
jest.mock('@/data-engine/browser.client', () => ({ createBrowserDataEngine: jest.fn() }));
jest.mock('idb-keyval', () => ({ createStore: jest.fn() }));

// Pointer geometry is exercised in native Chrome. Here the real editor and IndexedDB own the drop result.
jest.mock('@/components/plan-editor/OutlineBoard', () => ({
  __esModule: true,
  default: ({ value, onChange, onPointMove }: {
    value: SermonOutline; onChange: (outline: SermonOutline) => void; onPointMove?: (outline: SermonOutline, pointId: string) => void;
  }) => {
    const move = (section: 'introduction' | 'conclusion') => {
      const [point, ...main] = value.main;
      const next = { ...value, main, [section]: [...value[section], point] };
      if (onPointMove) onPointMove(next, point.id);
      else onChange(next);
    };
    return <>
      <button type="button" onClick={() => move('introduction')}>Move to Introduction</button>
      <button type="button" onClick={() => move('conclusion')}>Move to Conclusion</button>
    </>;
  },
}));

const resource = { collection: 'planTemplates', id: 'template-one' };
const createdAt = '2026-11-09T00:00:00.000Z';
const point = { id: 'point', text: 'Keep this point', subPoints: [{ id: 'child', text: 'Keep these words', position: 0 }] };
const neighbor = { id: 'neighbor', text: 'Independent text' };
const opening = { introduction: [], main: [point, neighbor], conclusion: [] };

it.each([
  { label: 'Introduction', section: 'introduction' },
  { label: 'Conclusion', section: 'conclusion' },
])('captures an offline template gesture to $label as the position of one point', async ({ label, section }) => {
  const h = documentEngineHarness({ resource, metadata: { protocol: 1, generation: 'template-generation', revision: 3, deleted: false },
    value: { userId: 'u1', name: 'Template', structure: opening, createdAt, updatedAt: createdAt } });
  jest.mocked(createBrowserDataEngine).mockImplementation(h.createBrowser);
  const editor = createRef<TemplateOutlineEditorHandle>();
  const view = render(<DataEngineProvider><TemplateOutlineEditor ref={editor} templateId={resource.id} disabled={false} /></DataEngineProvider>);
  try {
    const move = await screen.findByRole('button', { name: 'Move to ' + label });
    await act(async () => { h.engine.setOnline(false); await settleEngine(); });
    await act(async () => { fireEvent.click(move); await settleEngine(); });
    await act(async () => { await editor.current!.capture(); await settleEngine(); });
    const saved = (await h.commits.list('u1')).filter(item => item.baseline.resource.id === resource.id);
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({ value: { structure: { main: [neighbor], [section]: [point] } },
      outlinePointPlacement: { generation: 'template-generation', placement: { pointId: point.id, observedRevision: 3,
        opening: { section: 'main', previous: null, next: neighbor.id },
        destination: { section, previous: null, next: null } } } });
    expect(h.transport.send).not.toHaveBeenCalled();
  } finally { view.unmount(); await act(settleEngine); }
});

it('distinguishes the retained move from the retained content of the same template', async () => {
  const generation = 'template-generation';
  const initial = { resource, metadata: { protocol: 1 as const, generation, revision: 3, deleted: false },
    value: { userId: 'u1', name: 'Template', structure: opening, createdAt, updatedAt: createdAt } };
  const h = documentEngineHarness(initial);
  const moved = { ...opening, introduction: [point], main: [neighbor] };
  const words = { ...opening, main: [{ ...point, text: 'My separate words' }, neighbor] };
  const capture = captureOutlinePointPlacement(opening, moved, point.id, generation, 3, null)!;
  for (const [id, structure] of [['move', moved], ['words', words]] as const) {
    const session = new DataSession(initial);
    session.edit({ ...initial.value, structure });
    await h.checkpoints.put({ owner: 'u1', editorId: manualChoiceRecoveryIdentity('reviewed', id),
      checkpoint: session.checkpoint(), prepared: null, unfinalized: [],
      retainedManualChoice: { base: initial.value, ...(id === 'move'
        ? { outlinePointPlacement: capture } : { templateFieldsGeneration: generation }) } });
  }
  jest.mocked(createBrowserDataEngine).mockImplementation(h.createBrowser);
  const view = render(<DataEngineProvider><TemplateOutlineEditor templateId={resource.id} disabled={false} /></DataEngineProvider>);
  try {
    expect(await screen.findByRole('option', { name: /Keep this point.*(?:structure\.introduction|Introduction)/ })).toBeVisible();
    expect(screen.getByRole('option', { name: /Template.*(?:structure\.content|Content)/ })).toBeVisible();
  } finally { view.unmount(); await act(settleEngine); }
});
