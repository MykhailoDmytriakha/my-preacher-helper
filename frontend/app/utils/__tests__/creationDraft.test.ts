import { clearDraftIfMatches, clearCreationDraft, draftKey, isDraftStorageRefusedFor, moveDraft, readDraft, saveDraft } from '../durableDraft';
const SOURCE=draftKey('creation-owner','new','note'),DEST=draftKey('creation-owner','created-A','note');
beforeEach(()=>localStorage.clear());afterEach(()=>{jest.restoreAllMocks();clearCreationDraft(SOURCE,'created-A');clearCreationDraft(SOURCE,'created-B');clearDraftIfMatches(DEST,{text:'A'});});
describe('precreate draft lineage',()=>{
 it('settles its refusal even when the very first draft and carry could not be stored',()=>{
  jest.spyOn(Storage.prototype,'setItem').mockImplementation(()=>{throw new DOMException('Full','QuotaExceededError');});jest.spyOn(console,'error').mockImplementation(()=>undefined);
  expect(saveDraft(SOURCE,{text:'A'},'created-A')).toBe(false);expect(isDraftStorageRefusedFor('creation-owner')).toBe(true);
  moveDraft(SOURCE,DEST,'created-A');clearCreationDraft(SOURCE,'created-A');
  expect(isDraftStorageRefusedFor('creation-owner')).toBe(true);
  clearDraftIfMatches(DEST,{text:'A'});expect(isDraftStorageRefusedFor('creation-owner')).toBe(false);
  // A carried refusal belongs to its stable destination, whose exact payload confirms it.
 });
 it('does not settle a different creation refusal or remove its matching stored value',()=>{
  saveDraft(SOURCE,{text:'A'},'created-B');const set=Storage.prototype.setItem;jest.spyOn(Storage.prototype,'setItem').mockImplementation(function(this:Storage,key,data){if(key===SOURCE)throw new DOMException('Full','QuotaExceededError');set.call(this,key,data);});jest.spyOn(console,'error').mockImplementation(()=>undefined);
  saveDraft(SOURCE,{text:'New B'},'created-B');clearCreationDraft(SOURCE,'created-A');
  expect(readDraft(SOURCE)?.value).toEqual({text:'A'});expect(isDraftStorageRefusedFor('creation-owner')).toBe(true);
 });
 it('leaves legacy unowned records and another account alone',()=>{
  saveDraft(SOURCE,{text:'Legacy'});const other=draftKey('another-creation-owner','new','note');saveDraft(other,{text:'Private'},'created-A');
  clearCreationDraft(SOURCE,'created-A');expect(readDraft(SOURCE)?.value).toEqual({text:'Legacy'});expect(readDraft(other)?.value).toEqual({text:'Private'});
 });
 it('copies the full lineage only after verifying its own source and leaves later stable-id words alone',()=>{
  saveDraft(SOURCE,{text:'A'},'created-A');moveDraft(SOURCE,DEST,'created-A');expect(readDraft(SOURCE)).toBeNull();expect(readDraft(DEST)?.creationTargetId).toBe('created-A');
  saveDraft(DEST,{text:'Later B'});clearCreationDraft(SOURCE,'created-A');expect(readDraft(DEST)?.value).toEqual({text:'Later B'});expect(readDraft(DEST)?.creationTargetId).toBeUndefined();
 });
});
