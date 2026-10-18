import { act, renderHook } from '@testing-library/react';
import { useRef, useState } from 'react';
import { useDurableDraft } from '@/hooks/useDurableDraft';
import { draftKey, readDraft } from '@/utils/durableDraft';
import { persistedWrite, queuedMutation } from '@/utils/recoverableWrite';
import { useNoteAutoSave } from '../useNoteAutoSave';
import type { NoteDraftPayload } from '../noteDraft';
const OWNER='placeholder-owner', TARGET='reserved-note-A';
const SOURCE=draftKey(OWNER,'new','note'), DEST=draftKey(OWNER,TARGET,'note');
const value=(content:string):NoteDraftPayload=>({title:'',content,tags:[],scriptureRefs:[],type:'note'});
function useEditor(content:string,createNote:jest.Mock){
 const [id,setId]=useState('new');const baselineRef=useRef<NoteDraftPayload|null>(null),revisionRef=useRef<number|null>(null),deliberateOverwriteRef=useRef(false);
 const draftOptions={uid:OWNER,docId:id,aggregate:'note',value:value(content),enabled:true,confirmedValue:null,creationTargetId:id==='new'?TARGET:undefined};
 const draft=useDurableDraft(draftOptions);
 const options={noteId:id,isNew:id==='new',creationId:TARGET,isInitialized:true,...value(content),updateNote:jest.fn(),createNote:createNote as never,uid:OWNER,setCreatedNoteId:setId,t:((s:string)=>s)as never,baselineRef,revisionRef,deliberateOverwriteRef,resaveNonce:0,saveBlocked:false,onConflict:jest.fn(),onSaved:draft.markSaved};
 return {id,draft,save:useNoteAutoSave(options)};
}
function source(content:string,target:string|null=TARGET){localStorage.setItem(SOURCE,JSON.stringify({value:value(content),savedAt:1,...(target?{creationTargetId:target}:{})}));}
function recovery(confirmed:ReadonlySet<string>){const options={uid:OWNER,docId:'new',aggregate:'note',value:value(''),enabled:false,confirmedValue:null,creationTargetId:'next-note',confirmedCreationIds:confirmed};return renderHook(()=>useDurableDraft(options));}
describe('new-note placeholder ownership',()=>{
 let quota:boolean;
 beforeEach(()=>{jest.useFakeTimers();localStorage.clear();quota=false;const set=Storage.prototype.setItem;jest.spyOn(Storage.prototype,'setItem').mockImplementation(function(this:Storage,key,data){if(quota&&key.startsWith('draft:v1:'))throw new DOMException('Full','QuotaExceededError');set.call(this,key,data);});jest.spyOn(console,'error').mockImplementation(()=>undefined);});
 afterEach(()=>{jest.restoreAllMocks();jest.useRealTimers();});
 it.each(['queued','persisted']as const)('retires the owned older source after failed carry and %s creation acceptance',async mode=>{
  let accept!:()=>void;const persistence=new Promise<void>(r=>{accept=r;});const create=jest.fn(()=>({...mode==='queued'?queuedMutation('create:'+TARGET,persistence):persistedWrite(persistence),note:{id:TARGET}}));
  const hook=renderHook(({content})=>useEditor(content,create),{initialProps:{content:'A'}});
  await act(async()=>{jest.advanceTimersByTime(300);});expect(readDraft(SOURCE)?.value).toEqual(value('A'));
  quota=true;hook.rerender({content:'AB'});await act(async()=>{jest.advanceTimersByTime(1600);});
  expect(create).toHaveBeenCalledTimes(1);expect(hook.result.current.id).toBe(TARGET);expect(readDraft(SOURCE)?.value).toEqual(value('A'));expect(readDraft(DEST)).toBeNull();expect(hook.result.current.save.lastSaved).toBeNull();
  quota=false;await act(async()=>{accept();await persistence;});expect(hook.result.current.save.lastSaved).toBeInstanceOf(Date);expect(readDraft(SOURCE)).toBeNull();hook.unmount();
 });
 it('does not move another new editor source when this note creates',async()=>{
  const persistence=new Promise<void>(()=>undefined);const create=jest.fn(()=>({...queuedMutation('create:'+TARGET,persistence),note:{id:TARGET}}));const hook=renderHook(()=>useEditor('A',create));
  await act(async()=>{jest.advanceTimersByTime(300);});source('Independent B','reserved-note-B');await act(async()=>{jest.advanceTimersByTime(1300);});
  expect(create).toHaveBeenCalledTimes(1);expect(readDraft(SOURCE)?.value).toEqual(value('Independent B'));expect(readDraft(DEST)?.value).not.toEqual(value('Independent B'));hook.unmount();
 });
 it('keeps an ambiguous targetless source while a reserved note creates',async()=>{
  const persistence=new Promise<void>(()=>undefined);const create=jest.fn(()=>({...queuedMutation('create:'+TARGET,persistence),note:{id:TARGET}}));const hook=renderHook(()=>useEditor('Current words',create));
  await act(async()=>{jest.advanceTimersByTime(300);});source('Unclaimed legacy words',null);await act(async()=>{jest.advanceTimersByTime(1300);});
  expect(create).toHaveBeenCalledTimes(1);expect(readDraft(SOURCE)?.value).toEqual(value('Unclaimed legacy words'));expect(readDraft(SOURCE)?.creationTargetId).toBeUndefined();expect(readDraft(DEST)?.value).not.toEqual(value('Unclaimed legacy words'));hook.unmount();
 });
 it('does not offer a precreate source after matching confirmed creation is found on later opening',()=>{source('A');const hook=recovery(new Set([TARGET]));expect(hook.result.current.recovered).toBeNull();expect(readDraft(SOURCE)).toBeNull();hook.unmount();});
 it('keeps unconfirmed creation recoverable',()=>{source('A');const hook=recovery(new Set());expect(hook.result.current.recovered).toEqual(value('A'));expect(readDraft(SOURCE)?.value).toEqual(value('A'));hook.unmount();});
 it('keeps ambiguous legacy source despite another confirmed creation',()=>{source('A',null);const hook=recovery(new Set([TARGET]));expect(hook.result.current.recovered).toEqual(value('A'));expect(readDraft(SOURCE)?.value).toEqual(value('A'));hook.unmount();});
 it('keeps equal-text independent replacement and later real-id words after earlier creation ACK',async()=>{
  let accept!:()=>void;const persistence=new Promise<void>(r=>{accept=r;});const create=jest.fn(()=>({...queuedMutation('create:'+TARGET,persistence),note:{id:TARGET}}));const hook=renderHook(({content})=>useEditor(content,create),{initialProps:{content:'A'}});
  await act(async()=>{jest.advanceTimersByTime(300);});quota=true;hook.rerender({content:'AB'});await act(async()=>{jest.advanceTimersByTime(1600);});quota=false;source('A','reserved-note-B');localStorage.setItem(DEST,JSON.stringify({value:value('Later C'),savedAt:3}));
  await act(async()=>{accept();await persistence;});expect(readDraft(SOURCE)?.value).toEqual(value('A'));expect(readDraft(DEST)?.value).toEqual(value('Later C'));hook.unmount();
 });
});
