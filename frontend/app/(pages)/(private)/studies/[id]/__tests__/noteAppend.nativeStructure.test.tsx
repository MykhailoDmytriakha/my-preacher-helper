import { act } from '@testing-library/react';
import {start,stand,md,finish,stored} from '@test-utils/noteOrdering';

it.each(['split','break','bold'])('native %s survives a transcript before DOM observation',async(kind)=>{
 await start('FirstSecond');
 act(()=>stand.editor.commands.setTextSelection(6));
 let nativeAtAppend:unknown;
 await act(async()=>{
  const transcript=Promise.resolve().then(()=>{nativeAtAppend={dom:stand.editor.view.dom.textContent,doc:stand.editor.state.doc.textContent,html:stand.editor.view.dom.innerHTML,composing:stand.editor.view.composing};return stand.voice.onText('Voiceword','source-native-'+kind);});
  const dom=stand.editor.view.dom;
  const p=dom.querySelector('p')!, text=p.firstChild as Text;
  const second=text.splitText(5);
  if(kind==='split'){const next=document.createElement('p');next.append(second);p.after(next);}
  if(kind==='break')p.insertBefore(document.createElement('br'),second);
  if(kind==='bold'){const strong=document.createElement('strong');p.insertBefore(strong,text);strong.append(text);}
  const sel=window.getSelection()!,range=document.createRange();range.setStart(second,0);range.collapse(true);sel.removeAllRanges();sel.addRange(range);
  dom.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:kind==='split'?'insertParagraph':kind==='break'?'insertLineBreak':'formatBold'}));
  await transcript;
 });
 await finish();
 const row={kind,nativeAtAppend,editor:md(),page:stand.autosave.content,stored:await stored(),doc:stand.editor.state.doc.toJSON()};
 if(kind==='split'){
  expect(nativeAtAppend).toMatchObject({dom:'FirstSecond',doc:'FirstSecond',composing:false});
  expect(row.editor).toContain('First\n\nSecond');
 }
 expect(row.editor).toContain('Voiceword');
 expect(row.page).toBe(row.editor);
 expect(row.stored).toBe(row.editor);
 if(kind==='break')expect(stand.editor.state.doc.firstChild!.childCount).toBe(3);
 if(kind==='bold')expect(row.editor).toContain('**First**');
});
