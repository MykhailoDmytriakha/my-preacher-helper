'use client';

import { useCallback, useRef, useState } from 'react';

import { usePersistedConflict } from '@/hooks/usePersistedConflict';
import { validOutlineConflict } from '@/utils/refusedDraftPayloads';

import type { PersistedConflict, PersistedConflictWriteOptions } from '@/hooks/usePersistedConflict';
import type { SermonOutline } from '@/models/models';

export interface OutlineConflictPayload {
  outline: SermonOutline;
  serverOutline: SermonOutline | null;
  /** Absence marks a legacy copy whose changed fields cannot be inferred. Null is a known absence. */
  baseOutline?: SermonOutline | null;
  resolution?: 'local';
  reviewWhole?: boolean;
}
export type OutlineConflictRecord = PersistedConflict<OutlineConflictPayload>;

/** One durable question or selected pending value; storage and conditional clearing stay shared. */
export function useOutlineConflict(owner: string, id: string) {
  const identity=JSON.stringify([owner,id]), current=useRef(identity);
  current.current=identity;
  const holds=useRef(new Map<string,number>());
  const [editingIdentity,setEditingIdentity]=useState<string|null>(null);
  const editing=editingIdentity===identity;
  const preserveSelectionOnWake=useCallback(() => (holds.current.get(identity)??0)>0,[identity]);
  const [record, setRecord, ready, choices] = usePersistedConflict<OutlineConflictPayload>(owner,id,'outlineConflict',validOutlineConflict,preserveSelectionOnWake);
  const capture=choices.capture;
  const get=useCallback(() => current.current===identity ? capture()?.value ?? null : null,[identity,capture]);
  const put=useCallback((next:OutlineConflictRecord | null, options?:PersistedConflictWriteOptions) => {
    const previous=get();
    setRecord(next,id,previous ?? undefined,options);
  },[id,setRecord,get]);
  const ask=useCallback((outline:SermonOutline,base:SermonOutline | null,serverOutline:SermonOutline | null) => {
    const next={payload:{outline,baseOutline:base,serverOutline},actualRevision:0};
    setRecord(next,id);
  },[id,setRecord]);
  const retain=useCallback((outline:SermonOutline,base:SermonOutline | null,serverOutline:SermonOutline | null) => {
    // Keep a departed refusal in its original owner/document namespace; the storage hook
    // guards view publication, so an old outcome cannot alter the new current editor.
    const next={payload:{outline,baseOutline:base,serverOutline},actualRevision:0};
    setRecord(next,id,undefined,{preserveSelection:(holds.current.get(identity)??0)>0});
  },[id,setRecord,identity]);
  const edit=useCallback((outline:SermonOutline) => {
    const previous=get();
    if (previous) put({...previous,payload:{...previous.payload,outline}});
  },[get,put]);
  const select=useCallback((outline:SermonOutline,serverOutline:SermonOutline | null) => {
    put({payload:{outline,baseOutline:serverOutline,serverOutline,resolution:'local'},actualRevision:0});
  },[put]);
  const clear=useCallback(() => put(null,{preserveSelection:(holds.current.get(identity)??0)>0}),[put,identity]);
  const retire=useCallback((captured:OutlineConflictRecord | null) => {
    if (captured?.payload.resolution==='local') setRecord(null,id,captured,{preserveSelection:(holds.current.get(identity)??0)>0});
  },[id,setRecord,identity]);
  const requireWholeReview=useCallback(() => {
    const previous=get();
    if (previous) put({...previous,payload:{...previous.payload,reviewWhole:true}});
  },[get,put]);
  const reload=choices.reload;
  const holdSelection=useCallback(() => {
    const heldIdentity=identity;
    holds.current.set(heldIdentity,(holds.current.get(heldIdentity)??0)+1);
    if(current.current===heldIdentity)setEditingIdentity(heldIdentity);
    let released=false;
    return () => {
      if(released)return;
      released=true;
      const count=holds.current.get(heldIdentity)??0;
      if(count<=1)holds.current.delete(heldIdentity);
      else holds.current.set(heldIdentity,count-1);
      if(count<=1&&current.current===heldIdentity){
        setEditingIdentity(null);
        reload();
      }
    };
  },[identity,reload]);
  return {record:ready ? record : null,ready,editing,get,ask,retain,edit,select,clear,retire,requireWholeReview,holdSelection,choices,choose:choices.select,activation:choices.activation};
}
