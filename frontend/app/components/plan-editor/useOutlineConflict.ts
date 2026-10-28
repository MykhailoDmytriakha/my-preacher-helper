'use client';

import { useCallback, useRef } from 'react';

import { usePersistedConflict } from '@/hooks/usePersistedConflict';
import { validOutlineConflict } from '@/utils/refusedDraftPayloads';

import type { PersistedConflict } from '@/hooks/usePersistedConflict';
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
  const [record, setRecord, ready, choices] = usePersistedConflict<OutlineConflictPayload>(owner,id,'outlineConflict',validOutlineConflict);
  const identity=JSON.stringify([owner,id]), current=useRef(identity);
  current.current=identity;
  const capture=choices.capture;
  const get=useCallback(() => current.current===identity ? capture()?.value ?? null : null,[identity,capture]);
  const put=useCallback((next:OutlineConflictRecord | null) => {
    const previous=get();
    setRecord(next,id,previous ?? undefined);
  },[id,setRecord,get]);
  const ask=useCallback((outline:SermonOutline,base:SermonOutline | null,serverOutline:SermonOutline | null) => {
    const next={payload:{outline,baseOutline:base,serverOutline},actualRevision:0};
    setRecord(next,id);
  },[id,setRecord]);
  const edit=useCallback((outline:SermonOutline) => {
    const previous=get();
    if (previous) put({...previous,payload:{...previous.payload,outline}});
  },[get,put]);
  const select=useCallback((outline:SermonOutline,serverOutline:SermonOutline | null) => {
    put({payload:{outline,baseOutline:serverOutline,serverOutline,resolution:'local'},actualRevision:0});
  },[put]);
  const clear=useCallback(() => put(null),[put]);
  const retire=useCallback((captured:OutlineConflictRecord | null) => {
    if (captured?.payload.resolution==='local') setRecord(null,id,captured);
  },[id,setRecord]);
  const requireWholeReview=useCallback(() => {
    const previous=get();
    if (previous) put({...previous,payload:{...previous.payload,reviewWhole:true}});
  },[get,put]);
  return {record:ready ? record : null,ready,get,ask,edit,select,clear,retire,requireWholeReview,choices,choose:choices.select,activation:choices.activation};
}
