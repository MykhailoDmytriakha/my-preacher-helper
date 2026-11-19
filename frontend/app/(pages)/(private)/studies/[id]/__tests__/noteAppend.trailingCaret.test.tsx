import {act} from '@testing-library/react';
import {start,stand,md,finish,stored} from '@test-utils/noteOrdering';
it.each(['- First\n- Second','1. First\n2. Second'])('keeps the empty paragraph caret when appending another item to %j',async source=>{
 await start(source,true);
 act(()=>stand.editor.commands.setTextSelection(1));
 act(()=>stand.editor.commands.setTextSelection(stand.editor.state.doc.content.size-1));
 expect(stand.editor.state.selection.$head.parent.textContent).toBe('');
 const before=stand.editor.state.selection.toJSON();
 await act(async()=>{await stand.voice.onText(source.startsWith('-')?'- Third':'1. Third','source-list');});
 const caretParent=stand.editor.state.selection.$head.parent.textContent;
 const after=stand.editor.state.selection.toJSON();
 act(()=>{stand.editor.commands.insertContent('X');});
 await finish();
 expect(caretParent).toBe('');
 expect(md()).toMatch(/Third\n\nX$/);
 expect(await stored()).toBe(md());
});
