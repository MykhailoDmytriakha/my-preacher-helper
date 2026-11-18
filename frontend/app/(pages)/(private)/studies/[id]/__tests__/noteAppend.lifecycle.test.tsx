import {act,fireEvent,screen} from '@testing-library/react';
import {start,stand,md,finish,settle} from '@test-utils/noteOrdering';
it('deduplicates the same pending source and retries it once after Done then Edit',async()=>{
 await start('Original');
 const composing=jest.spyOn(stand.editor.view,'composing','get').mockReturnValue(true);
 let first!:Promise<unknown>,duplicate!:Promise<unknown>;
 await act(async()=>{
  first=Promise.resolve(stand.voice.onText('Voice','source-a')).catch(e=>e);
  duplicate=Promise.resolve(stand.voice.onText('Voice','source-a')).catch(e=>e);
 });
 expect(stand.autosave.dictationSourceIds).not.toContain('source-a');
 fireEvent.click(screen.getByRole('button',{name:'common.done'}));
 await settle(50);
 expect(await first).toEqual(new Error('The note editor closed before text could be appended'));
 expect(await duplicate).toEqual(new Error('The note editor closed before text could be appended'));
 fireEvent.click(screen.getByTitle('common.edit'));await settle(50);
 await act(async()=>{await stand.voice.onText('Voice','source-a');await stand.voice.onText('Voice','source-a');});
 await finish();
 expect(md().match(/Voice/g)).toHaveLength(1);
 expect(stand.autosave.dictationSourceIds).toEqual(['source-a']);
 composing.mockRestore();
});
it('rejects the old pending source when the entire page unmounts and a new note opens',async()=>{
 await start('Original');
 const composing=jest.spyOn(stand.editor.view,'composing','get').mockReturnValue(true);
 let pending!:Promise<unknown>;
 await act(async()=>{pending=Promise.resolve(stand.voice.onText('WrongNoteVoice','source-old')).catch(e=>e);});
 await stand.remount('new');await settle(50);
 expect(await pending).toEqual(new Error('The note editor closed before text could be appended'));
 expect(stand.autosave.content).not.toContain('WrongNoteVoice');
 expect(stand.autosave.dictationSourceIds).not.toContain('source-old');
 composing.mockRestore();
});
