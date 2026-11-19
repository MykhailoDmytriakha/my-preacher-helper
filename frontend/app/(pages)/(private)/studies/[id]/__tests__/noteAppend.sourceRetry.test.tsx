import { act, fireEvent, screen } from '@testing-library/react';
import {start,stand,finish,stored,pulse,settle} from '@test-utils/noteDictationStand';
it('retries the cached transcript after Done rejects its pending insertion and an unrelated save has completed',async()=>{
 await start('Original');
 const composing=jest.spyOn(stand.editor.view,'composing','get').mockReturnValue(true);
 try {
  await act(async()=>{stand.voiceController.complete(new Blob(['audio'],{type:'audio/webm'}));await pulse();});

  await finish();
  fireEvent.click(screen.getByRole('button',{name:'common.done'}));
  await settle(50);
  fireEvent.click(screen.getByTitle('common.edit'));
  await settle(50);
  await act(async()=>{stand.voiceController.retry();await pulse();});
  await finish();

  expect(await stored()).toContain('Voiceword');
 } finally {composing.mockRestore();}
});
