import { act, renderHook } from '@testing-library/react';

import { useEditorOwnedText } from '@/components/ui/useEditorOwnedText';

import type { OwnedTextDocument } from '@/components/ui/useEditorOwnedText';

it('changes live text immediately without a document, preserving raw source', () => {
  const { result } = renderHook(() => useEditorOwnedText('<!-- source -->'));
  act(() => {
    result.current.append('Voice');
    expect(result.current.live()).toBe('<!-- source -->\n\nVoice');
    result.current.replace('Recovered');
    expect(result.current.live()).toBe('Recovered');
    result.current.follow('Arrival');
    expect(result.current.live()).toBe('Arrival');
    result.current.ownedBy.emit('Typed');
    expect(result.current.live()).toBe('Typed');
  });
  expect(result.current.text).toBe('Typed');
});

it('updates the registered document before publishing each page change without emitting', () => {
  const { result } = renderHook(() => useEditorOwnedText('Opening'));
  const events: string[] = [];
  const document: OwnedTextDocument = {
    install: value => events.push(`install:${value}:${result.current.live()}`),
    append: value => { events.push(`append:${value}:${result.current.live()}`); },
    replace: value => events.push(`replace:${value}:${result.current.live()}`),
  };
  const owner = result.current.ownedBy;
  owner.register(document);
  act(() => {
    result.current.follow('Arrival');
    result.current.append('Voice');
    result.current.replace('Recovered');
    owner.emit('Typed');
  });
  expect(events).toEqual(['install:Arrival:Opening', 'append:Arrival\n\nVoice:Arrival', 'replace:Recovered:Arrival\n\nVoice']);
  expect(result.current.text).toBe('Typed');
  expect(result.current.ownedBy).toBe(owner);
});

it('unregisters only its own instance even when an old instance dies late', () => {
  const { result } = renderHook(() => useEditorOwnedText('Opening'));
  const old = { install: jest.fn(), append: jest.fn(), replace: jest.fn() };
  const current = { install: jest.fn(), append: jest.fn(), replace: jest.fn() };
  const releaseOld = result.current.ownedBy.register(old);
  const releaseCurrent = result.current.ownedBy.register(current);
  releaseOld();
  act(() => { result.current.follow('Arrival'); result.current.append('Voice'); });
  expect(current.install).toHaveBeenCalledWith('Arrival');
  expect(current.append).toHaveBeenCalledWith('Arrival\n\nVoice');
  expect(old.install).not.toHaveBeenCalled();
  releaseCurrent();
  act(() => result.current.replace('Reading'));
  expect(current.replace).not.toHaveBeenCalled();
  expect(result.current.live()).toBe('Reading');
});

it('appends to an empty note without a leading paragraph separator', () => {
  const { result } = renderHook(() => useEditorOwnedText(''));
  act(() => result.current.append('Voice'));
  expect(result.current.text).toBe('Voice');
});

it('does not operate on the document or publish an identical follow', () => {
  let renders = 0;
  const { result } = renderHook(() => { renders++; return useEditorOwnedText('Opening'); });
  const document = { install: jest.fn(), append: jest.fn(), replace: jest.fn() };
  result.current.ownedBy.register(document);
  const before = renders;
  act(() => result.current.follow('Opening'));
  expect(document.install).not.toHaveBeenCalled();
  expect(renders).toBe(before);
  expect(result.current.live()).toBe('Opening');
});

it('leaves an identical replacement unpublished and does not call the document', () => {
  let renders = 0;
  const { result } = renderHook(() => { renders++; return useEditorOwnedText('Opening'); });
  const document = { install: jest.fn(), append: jest.fn(), replace: jest.fn() };
  result.current.ownedBy.register(document);
  const before = renders;
  act(() => result.current.replace('Opening'));
  expect(document.replace).not.toHaveBeenCalled();
  expect(renders).toBe(before);
  expect(result.current.live()).toBe('Opening');
});
