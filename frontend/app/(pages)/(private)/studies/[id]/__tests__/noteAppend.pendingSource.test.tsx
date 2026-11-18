import { act, fireEvent, screen } from '@testing-library/react';
import {start,stand,finish,stored,pulse,settle} from '@test-utils/noteDictationStand';
it('preserves the cached transcript while a composition blocks its insertion and a metadata save finishes',async()=>{
 await start('Original');
 const composing=jest.spyOn(stand.editor.view,'composing','get').mockReturnValue(true);
 try {
  await act(async()=>{stand.voiceController.complete(new Blob(['audio'],{type:'audio/webm'}));await pulse();});
  expect(stand.voiceController.isProcessing).toBe(true);
  expect(stand.recordings).toHaveLength(1);
  await finish();
  const preserved=stand.recordings.length;
  fireEvent.click(screen.getByRole('button',{name:'common.done'}));
  await settle(50);
  fireEvent.click(screen.getByTitle('common.edit'));
  await settle(50);
  await act(async()=>{stand.voiceController.retry();await pulse();});
  await finish();
  expect(preserved).toBe(1);
  expect(await stored()).toContain('Voiceword');
 } finally {composing.mockRestore();}
});
