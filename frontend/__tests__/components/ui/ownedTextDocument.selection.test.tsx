import {act,render,renderHook} from '@testing-library/react';
import {RichMarkdownEditor} from '@/components/ui/RichMarkdownEditor';
import {useEditorOwnedText} from '@/components/ui/useEditorOwnedText';
import {canonicalForeignTarget} from '@/components/ui/foreignContent';
import {TextSelection,NodeSelection,AllSelection} from '@tiptap/pm/state';
import {CellSelection} from '@tiptap/pm/tables';
import {GapCursor} from '@tiptap/pm/gapcursor';
import {undoDepth} from '@tiptap/pm/history';
import type {Editor} from '@tiptap/core';
jest.mock('@/components/ui/RichMarkdownToolbar',()=>({RichMarkdownToolbar:()=>null}));
jest.mock('@tiptap/react',()=>{const actual=jest.requireActual<typeof import('@tiptap/react')>('@tiptap/react');return {...actual,useEditor:(...args:Parameters<typeof actual.useEditor>)=>{const e=actual.useEditor(...args);if(e)mockEditor=e;return e;}}});
let mockEditor:Editor;
it.each(['stored bold','explicit no marks','range backwards','node','all','cells','gap'])('preserves supported selection/history mechanics for %s',kind=>{
 const source=kind==='cells'?'| A | B |\n| --- | --- |\n| C | D |':kind==='gap'?'---\n\n---':'1. First\n2. Second';
 const {result}=renderHook(()=>useEditorOwnedText(source));render(<RichMarkdownEditor ownedBy={result.current.ownedBy}/>);
 act(()=>mockEditor.commands.setTextSelection(5));
 act(()=>{
  const tr=mockEditor.state.tr;
  if(kind==='stored bold')tr.setStoredMarks([mockEditor.schema.marks.bold.create()]);
  if(kind==='explicit no marks')tr.setStoredMarks([]);
  if(kind==='range backwards')tr.setSelection(TextSelection.create(tr.doc,7,4));
  if(kind==='node')tr.setSelection(NodeSelection.create(tr.doc,0));
  if(kind==='all')tr.setSelection(new AllSelection(tr.doc));
  if(kind==='cells'){const cells:number[]=[];tr.doc.descendants((n,p)=>{if(n.type.name==='tableCell'||n.type.name==='tableHeader')cells.push(p);});tr.setSelection(CellSelection.create(tr.doc,cells[0],cells[3]));}
  if(kind==='gap')tr.setSelection(new GapCursor(tr.doc.resolve(1)));
  mockEditor.view.dispatch(tr);
 });
 const before=mockEditor.state.doc,selection=mockEditor.state.selection.toJSON(),marks=mockEditor.state.storedMarks,depth=undoDepth(mockEditor.state);
 expect(mockEditor.view.dom.textContent).toBe(before.textContent);
 act(()=>{result.current.append(kind==='gap'?'Voice':'1. Third');});
 const after=mockEditor.state.doc;
 expect(after.eq(canonicalForeignTarget(mockEditor,result.current.live()))).toBe(true);
 expect(mockEditor.state.storedMarks).toEqual(marks);
 if(kind!=='all')expect(mockEditor.state.selection.toJSON()).toEqual(selection);
 expect(undoDepth(mockEditor.state)).toBe(depth+1);
 act(()=>{mockEditor.commands.undo();});expect(mockEditor.state.doc.eq(before)).toBe(true);
 act(()=>{mockEditor.commands.redo();});expect(mockEditor.state.doc.eq(after)).toBe(true);
});
