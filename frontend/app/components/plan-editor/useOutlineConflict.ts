'use client';

import { useCallback, useRef } from 'react';

import { usePersistedConflict } from '@/hooks/usePersistedConflict';

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
  const [record, setRecord, ready] = usePersistedConflict<OutlineConflictPayload>(owner,id,'outlineConflict');
  const identity=JSON.stringify([owner,id]), current=useRef(identity), latest=useRef(record);
  current.current=identity;
  latest.current=ready ? record : null;
  const get=useCallback(() => current.current===identity ? latest.current : null,[identity]);
  const put=useCallback((next:OutlineConflictRecord | null) => {
    if (current.current===identity) latest.current=next;
    setRecord(next,id);
  },[identity,id,setRecord]);
  const ask=useCallback((outline:SermonOutline,base:SermonOutline | null,serverOutline:SermonOutline | null) => {
    put({payload:{outline,baseOutline:base,serverOutline},actualRevision:0});
  },[put]);
  const edit=useCallback((outline:SermonOutline) => {
    const previous=get();
    if (previous) put({...previous,payload:{...previous.payload,outline}});
  },[get,put]);
  const select=useCallback((outline:SermonOutline,serverOutline:SermonOutline | null) => {
    put({payload:{outline,baseOutline:serverOutline,serverOutline,resolution:'local'},actualRevision:0});
  },[put]);
  const clear=useCallback(() => put(null),[put]);
  const retire=useCallback((captured:OutlineConflictRecord | null) => {
    if (captured && get()===captured && captured.payload.resolution==='local') put(null);
  },[get,put]);
  const requireWholeReview=useCallback(() => {
    const previous=get();
    if (previous) put({...previous,payload:{...previous.payload,reviewWhole:true}});
  },[get,put]);
  return {record:ready ? record : null,ready,get,ask,edit,select,clear,retire,requireWholeReview};
}
