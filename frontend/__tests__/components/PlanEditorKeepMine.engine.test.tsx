import React from 'react';
import { act, fireEvent, render, screen, within } from '@testing-library/react';

import PlanEditorModal from '@/components/plan-editor/PlanEditorModal';
import { draftKey, saveDraft } from '@/utils/durableDraft';
import { OutlineCollisionError } from '@/services/sermons.client';
import { createEngineStructureWriter } from '@/(pages)/(private)/sermons/[id]/structure/useEngineStructureWriter';
import { StructureWriterContext, type StructureWriter } from '@/components/sermon/structureWriter';
import type { DocumentData } from '@/data-engine/types';
import '@testing-library/jest-dom';

import type { Sermon, SermonOutline } from '@/models/models';

/**
 * "KEEP MINE" DECIDES ONLY THE POINT IT WAS ASKED ABOUT (BUG-20261011-keep-mine-overwrites-other-points).
 *
 * After a question about point p1, "keep mine" stated the server's whole plan as the base and sent
 * this screen's whole plan: every point the other device had changed — not only p1 — read as an
 * edit made here, and went back to its old words without another question.
 */
let mockWriter: StructureWriter;
const writerWrapper = ({children}: {children: React.ReactNode}) => <StructureWriterContext.Provider value={mockWriter}>{children}</StructureWriterContext.Provider>;
const renderEditor = (element: React.ReactElement) => render(element, {wrapper: writerWrapper});
jest.mock('@/hooks/usePlanTemplates', () => ({ usePlanTemplates: () => ({ templates: [], createTemplate: jest.fn() }) }));
jest.mock('@/hooks/useScrollLock', () => ({ useScrollLock: () => undefined }));
jest.mock('sonner', () => ({ toast: { error: jest.fn(), success: jest.fn() } }));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
/** What the next edit on the board does; a test sets it before clicking. */
let mockNextEdit: (value: SermonOutline) => SermonOutline = value => value;
jest.mock('@/components/plan-editor/OutlineBoard', () => ({
  __esModule: true,
  default: ({ value, onChange, isReadOnly }: { value: SermonOutline; onChange: (next: SermonOutline) => void; isReadOnly?: boolean }) => (
    <>
      <span data-testid="board">{value.main.map(point => point.text).join('|')}</span>
      <button type="button" disabled={isReadOnly} onClick={() => onChange(mockNextEdit(value))}>edit</button>
    </>
  ),
}));
const rewrite = (id: string, text: string) => (value: SermonOutline): SermonOutline =>
  ({ ...value, main: value.main.map(point => point.id === id ? { ...point, text } : point) });

const plan = (p1: string, p2: string): SermonOutline => ({
  introduction: [],
  main: [{ id: 'p1', text: p1 }, { id: 'p2', text: p2 }],
  conclusion: [],
});

const opened = plan('Grace', 'Mercy');
const sermon = { id: 's1', userId: 'u1', title: 'Sermon', verse: '', date: '2026-07-01', thoughts: [], outline: opened } as unknown as Sermon;

beforeAll(() => {
  const root = document.createElement('div');
  root.id = 'portal-root';
  document.body.appendChild(root);
});

describe('keep mine after a question about one point', () => {
  let server: SermonOutline;

  beforeEach(() => {
    jest.useFakeTimers();
    localStorage.clear();
    mockNextEdit = rewrite('p1', 'Grace, on the laptop');
    // The phone rewrote p1 AND p2 before this laptop saved.
    server = plan('Grace, on the phone', 'Mercy, on the phone');
    // Exercise the actual current writer; only the public document storage boundary is held here.
    mockWriter = createEngineStructureWriter({update: async apply => {
      const current = {...sermon, outline: server} as unknown as DocumentData;
      const next = apply(current) as unknown as Sermon;
      server = next.outline!;
    }}, 'u1');
  });
  afterEach(() => jest.useRealTimers());

  it("keeps this screen's p1 and the phone's p2", async () => {
    renderEditor(<PlanEditorModal isOpen sermon={sermon} onClose={() => undefined} onOutlineUpdate={jest.fn()} />);
    fireEvent.click(screen.getByText('edit'));
    await act(async () => { await jest.advanceTimersByTimeAsync(120); });
    expect(screen.getByText('freshness.conflictKeepMine')).toBeInTheDocument();

    fireEvent.click(screen.getByText('freshness.conflictKeepMine'));
    await act(async () => { await jest.advanceTimersByTimeAsync(120); });

    expect(server.main.map(point => point.text)).toEqual(['Grace, on the laptop', 'Mercy, on the phone']);
  });

  it('does the same after the editor was closed during the question and opened again', async () => {
    const view = renderEditor(<PlanEditorModal isOpen sermon={sermon} onClose={() => undefined} onOutlineUpdate={jest.fn()} />);
    fireEvent.click(screen.getByText('edit'));
    await act(async () => { await jest.advanceTimersByTimeAsync(120); });
    expect(screen.getByText('freshness.conflictKeepMine')).toBeInTheDocument();

    // Closed while the question was open, then opened again on today's server copy.
    const today = { ...sermon, outline: server } as Sermon;
    view.rerender(<PlanEditorModal isOpen={false} sermon={today} onClose={() => undefined} onOutlineUpdate={jest.fn()} />);
    view.rerender(<PlanEditorModal isOpen sermon={today} onClose={() => undefined} onOutlineUpdate={jest.fn()} />);
    fireEvent.click(screen.getByText('freshness.conflictKeepMine'));
    await act(async () => { await jest.advanceTimersByTimeAsync(120); });

    expect(server.main.map(point => point.text)).toEqual(['Grace, on the laptop', 'Mercy, on the phone']);
  });

  it('asks again, rather than overwrite, when the phone rewrote another point of mine while the question was open', async () => {
    server = plan('Grace, on the phone', 'Mercy');
    mockNextEdit = value => rewrite('p2', 'Mercy, on the laptop')(rewrite('p1', 'Grace, on the laptop')(value));
    renderEditor(<PlanEditorModal isOpen sermon={sermon} onClose={() => undefined} onOutlineUpdate={jest.fn()} />);
    fireEvent.click(screen.getByText('edit'));
    await act(async () => { await jest.advanceTimersByTimeAsync(120); });

    server = plan('Grace, on the phone', 'Mercy, rewritten on the phone later');
    fireEvent.click(screen.getByText('freshness.conflictKeepMine'));
    await act(async () => { await jest.advanceTimersByTimeAsync(120); });

    expect(server.main[1].text).toBe('Mercy, rewritten on the phone later');
    expect(screen.getByText('freshness.conflictKeepMine')).toBeInTheDocument();
  });

  it('saves what the person types right after choosing, without being stopped by the old question', async () => {
    renderEditor(<PlanEditorModal isOpen sermon={sermon} onClose={() => undefined} onOutlineUpdate={jest.fn()} />);
    fireEvent.click(screen.getByText('edit'));
    await act(async () => { await jest.advanceTimersByTimeAsync(120); });

    fireEvent.click(screen.getByText('freshness.conflictKeepMine'));
    mockNextEdit = rewrite('p1', 'Grace, on the laptop, and more');
    fireEvent.click(screen.getByText('edit'));
    await act(async () => { await jest.advanceTimersByTimeAsync(120); });

    expect(server.main[0].text).toBe('Grace, on the laptop, and more');
    expect(server.main[1].text).toBe('Mercy, on the phone');
  });

  it("keeps a point this screen moved to another section when the phone deleted it", async () => {
    const twoSections = (p1: string, p2Where: 'main' | 'conclusion' | 'gone'): SermonOutline => ({
      introduction: [],
      main: [{ id: 'p1', text: p1 }, ...(p2Where === 'main' ? [{ id: 'p2', text: 'Mercy' }] : [])],
      conclusion: p2Where === 'conclusion' ? [{ id: 'p2', text: 'Mercy' }] : [],
    });
    server = twoSections('Grace, on the phone', 'gone');
    mockNextEdit = () => twoSections('Grace, on the laptop', 'conclusion');
    renderEditor(<PlanEditorModal isOpen sermon={{ ...sermon, outline: twoSections('Grace', 'main') } as Sermon} onClose={() => undefined} onOutlineUpdate={jest.fn()} />);
    fireEvent.click(screen.getByText('edit'));
    await act(async () => { await jest.advanceTimersByTimeAsync(120); });
    fireEvent.click(screen.getByText('freshness.conflictKeepMine'));
    await act(async () => { await jest.advanceTimersByTimeAsync(120); });

    expect(server.conclusion.map(point => point.id)).toEqual(['p2']);
    expect(server.main[0].text).toBe('Grace, on the laptop');
  });

  it('keeps a moved sub-point in one place, as before, when the choice would hold it twice', async () => {
    const sub = { id: 's', text: 'Moving', position: 1 };
    const three = (p1: SermonOutline['main'][number]['subPoints'], p2: typeof p1, p3: typeof p1, p3Note?: string): SermonOutline => ({
      introduction: [], conclusion: [],
      main: [{ id: 'p1', text: 'One', subPoints: p1 }, { id: 'p2', text: 'Two', subPoints: p2 }, { id: 'p3', text: 'Three', subPoints: p3, ...(p3Note ? { note: p3Note } : {}) }],
    });
    const openedThree = three([sub], [], []);
    server = three([], [], [sub], 'phone note');
    mockNextEdit = () => three([], [sub], []);
    renderEditor(<PlanEditorModal isOpen sermon={{ ...sermon, outline: openedThree } as Sermon} onClose={() => undefined} onOutlineUpdate={jest.fn()} />);
    fireEvent.click(screen.getByText('edit'));
    await act(async () => { await jest.advanceTimersByTimeAsync(120); });
    expect(screen.getByText('freshness.conflictKeepMine')).toBeInTheDocument();
    fireEvent.click(screen.getByText('freshness.conflictKeepMine'));
    await act(async () => { await jest.advanceTimersByTimeAsync(120); });

    // The choice went through (no question left) and the sub-point sits where this screen put it.
    expect(screen.queryByText('freshness.conflictKeepMine')).not.toBeInTheDocument();
    const holders = server.main.filter(point => (point.subPoints ?? []).some(item => item.id === 's')).map(point => point.id);
    expect(holders).toEqual(['p2']);
    expect(server.main.find(point => point.id === 'p3')?.note).toBe('phone note');
  });
  it('keeps remote sub-point words while choosing only the rewritten parent words', async () => {
    const original = {...opened, main:[{id:'p1',text:'Grace',subPoints:[{id:'s',text:'Original sub',position:1}]},{id:'p2',text:'Mercy'}]};
    server = {...original, main:[{...original.main[0],text:'Remote parent',subPoints:[{id:'s',text:'Remote sub',position:1}]},{id:'p2',text:'Remote mercy'}]};
    mockNextEdit = rewrite('p1','Local parent');
    renderEditor(<PlanEditorModal isOpen sermon={{...sermon,outline:original}} onClose={() => undefined} />);
    fireEvent.click(screen.getByText('edit'));
    await act(async () => {await jest.advanceTimersByTimeAsync(120);});
    fireEvent.click(screen.getByText('freshness.conflictKeepMine'));
    await act(async () => {await jest.advanceTimersByTimeAsync(120);});
    expect(server.main[0].text).toBe('Local parent');
    expect(server.main[0].subPoints?.[0].text).toBe('Remote sub');
    expect(server.main[1].text).toBe('Remote mercy');
  });

  it('keeps a deliberate sub-point deletion when the other copy moved it to another parent', async () => {
    const sub = {id:'s',text:'Moving sub',position:1};
    const original: SermonOutline = {introduction:[],main:[{id:'p1',text:'One',subPoints:[sub]},{id:'p2',text:'Two',subPoints:[]}],conclusion:[]};
    server = {...original, main:[{id:'p1',text:'Remote one',subPoints:[]},{id:'p2',text:'Two',subPoints:[sub],note:'Remote note'}]};
    mockNextEdit = () => ({...original,main:[{id:'p1',text:'Local one',subPoints:[]},{id:'p2',text:'Two',subPoints:[]}]});
    renderEditor(<PlanEditorModal isOpen sermon={{...sermon,outline:original}} onClose={() => undefined} />);
    fireEvent.click(screen.getByText('edit'));
    await act(async () => {await jest.advanceTimersByTimeAsync(120);});
    fireEvent.click(screen.getByText('freshness.conflictKeepMine'));
    await act(async () => {await jest.advanceTimersByTimeAsync(120);});
    expect(server.main.flatMap(point => point.subPoints ?? []).map(item => item.id)).not.toContain('s');
    expect(server.main.find(point => point.id === 'p2')?.note).toBe('Remote note');
  });

  it('restores the refused board and its ancestor after a real unmount', async () => {
    const first=renderEditor(<PlanEditorModal isOpen sermon={sermon} onClose={() => undefined} />);
    fireEvent.click(screen.getByText('edit'));
    await act(async () => {await jest.advanceTimersByTimeAsync(120);});
    expect(screen.getByText('freshness.conflictKeepMine')).toBeInTheDocument();
    first.unmount();
    renderEditor(<PlanEditorModal isOpen sermon={{...sermon,outline:server}} onClose={() => undefined} />);
    expect(screen.getByTestId('board')).toHaveTextContent('Grace, on the laptop|Mercy');
    fireEvent.click(screen.getByText('freshness.conflictKeepMine'));
    await act(async () => {await jest.advanceTimersByTimeAsync(120);});
    expect(server.main.map(point => point.text)).toEqual(['Grace, on the laptop','Mercy, on the phone']);
  });

  it('does not retire newer pending typing when an older local capture completes', async () => {
    const releases:Array<() => void>=[];
    mockWriter=createEngineStructureWriter({update:async apply => {
      const next=apply({...sermon,outline:server} as unknown as DocumentData) as unknown as Sermon;
      server=next.outline!;
      await new Promise<void>(resolve => releases.push(resolve));
    }},'u1');
    renderEditor(<PlanEditorModal isOpen sermon={sermon} onClose={() => undefined} />);
    fireEvent.click(screen.getByText('edit'));
    await act(async () => {await jest.advanceTimersByTimeAsync(120);});
    fireEvent.click(screen.getByText('freshness.conflictKeepMine'));
    await act(async () => {await jest.advanceTimersByTimeAsync(120);});
    expect(releases).toHaveLength(1);
    mockNextEdit=rewrite('p1','Later local words');
    fireEvent.click(screen.getByText('edit'));
    await act(async () => {await jest.advanceTimersByTimeAsync(120);});
    // Newer accepted words already belong to the same engine draft before either disk write ends.
    expect(releases).toHaveLength(2);
    expect(server.main[0].text).toBe('Later local words');
    const key=Object.keys(localStorage).find(key => key.includes('outlineConflict'))!;
    await act(async () => {releases[0]();await Promise.resolve();});
    expect(releases).toHaveLength(2);
    expect(JSON.parse(localStorage.getItem(key)!).value.payload.outline.main[0].text).toBe('Later local words');
    await act(async () => {releases[1]();await Promise.resolve();});
    expect(localStorage.getItem(key)).toBeNull();
    expect(server.main.map(point => point.text)).toEqual(['Later local words','Mercy, on the phone']);
  });

  it('does not restore an old selected question after a newer editor has captured its continuation', async () => {
    const ordinary=mockWriter;
    const atQuestion=server;
    let rejectOld:((error:Error) => void) | undefined;
    mockWriter=createEngineStructureWriter({update:async apply => {
      apply({...sermon,outline:server} as unknown as DocumentData);
      await new Promise<void>((_resolve,reject) => {rejectOld=reject;});
    }},'u1');
    const first=renderEditor(<PlanEditorModal isOpen sermon={sermon} onClose={() => undefined} />);
    fireEvent.click(screen.getByText('edit'));
    await act(async () => {await jest.advanceTimersByTimeAsync(120);});
    fireEvent.click(screen.getByText('freshness.conflictKeepMine'));
    await act(async () => {await jest.advanceTimersByTimeAsync(120);});
    expect(rejectOld).toBeDefined();
    first.unmount();
    mockWriter=ordinary;
    renderEditor(<PlanEditorModal isOpen sermon={{...sermon,outline:server}} onClose={() => undefined} />);
    mockNextEdit=rewrite('p1','Newer continued words');
    fireEvent.click(screen.getByText('edit'));
    await act(async () => {await jest.advanceTimersByTimeAsync(120);});
    await act(async () => {rejectOld!(new OutlineCollisionError(['p1'],atQuestion,3));await Promise.resolve();});
    expect(Object.keys(localStorage).filter(key => key.includes('outlineConflict'))).toEqual([]);
    expect(screen.getByTestId('board')).toHaveTextContent('Newer continued words|Mercy, on the phone');
    expect(server.main[0].text).toBe('Newer continued words');
  });

  it('reviews both complete copies before replacing a legacy backup without an ancestor', async () => {
    const local = plan('Legacy local words', 'Mercy');
    saveDraft(draftKey('u1','s1','conflict:outlineConflict'), {
      payload: {outline:local,serverOutline:server}, actualRevision:0,
    });
    renderEditor(<PlanEditorModal isOpen sermon={{...sermon,outline:server}} onClose={() => undefined} />);
    expect(screen.queryByText('freshness.conflictKeepMine')).not.toBeInTheDocument();
    const replace = screen.getByRole('button',{name:'planEditor.useWholeLocalStructure'});
    expect(replace).toBeDisabled();
    fireEvent.click(screen.getByRole('button',{name:'planEditor.reviewCurrentStructure'}));
    expect(within(screen.getByRole('region',{name:'planEditor.currentStructure'})).getByTestId('board'))
      .toHaveTextContent('Grace, on the phone|Mercy, on the phone');
    expect(replace).toBeEnabled();
    fireEvent.click(replace);
    await act(async () => {await jest.advanceTimersByTimeAsync(120);});
    expect(server.main.map(point => point.text)).toEqual(['Legacy local words','Mercy']);
  });

  it('asks for whole-copy review when a scoped choice cannot represent the two structures', async () => {
    const base: SermonOutline = {introduction:[],main:[{id:'p1',text:'One',subPoints:[{id:'s',text:'Original child',position:1}]},{id:'p2',text:'Two'}],conclusion:[]};
    const local: SermonOutline = {introduction:[],main:[{id:'p2',text:'Two',subPoints:[{id:'p1',text:'One',position:1}]}],conclusion:[]};
    server = {...base,main:[{...base.main[0],subPoints:[...base.main[0].subPoints!,{id:'new',text:'New child from phone',position:2}]},base.main[1]]};
    saveDraft(draftKey('u1','s1','conflict:outlineConflict'), {
      payload: {outline:local,baseOutline:base,serverOutline:server}, actualRevision:0,
    });
    renderEditor(<PlanEditorModal isOpen sermon={{...sermon,outline:server}} onClose={() => undefined} />);
    fireEvent.click(screen.getByText('freshness.conflictKeepMine'));
    expect(screen.getByText('planEditor.wholeStructureDescription')).toBeInTheDocument();
    expect(screen.getByRole('button',{name:'planEditor.useWholeLocalStructure'})).toBeDisabled();
    expect(server.main[0].subPoints?.map(item => item.id)).toEqual(['s','new']);
  });

  it('shows a new refusal to the reopened editor when its resumed choice was waiting for an older capture', async () => {
    let rejectOld:((error:Error) => void) | undefined;
    mockWriter=createEngineStructureWriter({update:async apply => {
      const next=apply({...sermon,outline:server} as unknown as DocumentData) as unknown as Sermon;
      if (!rejectOld) await new Promise<void>((_resolve,reject) => {rejectOld=reject;});
      server=next.outline!;
    }},'u1');
    const view=renderEditor(<PlanEditorModal isOpen sermon={sermon} onClose={() => undefined} />);
    fireEvent.click(screen.getByText('edit'));
    await act(async () => {await jest.advanceTimersByTimeAsync(120);});
    fireEvent.click(screen.getByText('freshness.conflictKeepMine'));
    await act(async () => {await jest.advanceTimersByTimeAsync(120);});
    expect(rejectOld).toBeDefined();
    view.rerender(<PlanEditorModal isOpen={false} sermon={{...sermon,outline:server}} onClose={() => undefined} />);
    view.rerender(<PlanEditorModal isOpen sermon={{...sermon,outline:server}} onClose={() => undefined} />);
    mockNextEdit=rewrite('p1','Continued after reopening');
    fireEvent.click(screen.getByText('edit'));
    await act(async () => {await jest.advanceTimersByTimeAsync(120);});
    await act(async () => {rejectOld!(new OutlineCollisionError(['p1'],server,4));await Promise.resolve();});
    expect(screen.getByText('freshness.conflictKeepMine')).toBeInTheDocument();
    expect(screen.getByTestId('board')).toHaveTextContent('Continued after reopening|Mercy, on the phone');
    const key=Object.keys(localStorage).find(key => key.includes('outlineConflict'))!;
    expect(JSON.parse(localStorage.getItem(key)!).value.payload.resolution).toBeUndefined();
  });

});
