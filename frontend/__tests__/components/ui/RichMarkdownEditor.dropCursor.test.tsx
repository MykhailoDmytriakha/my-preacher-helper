import React from 'react';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { RichMarkdownEditor } from '@/components/ui/RichMarkdownEditor';
import { markdown, mountedEditor, typeAtEnd } from '@test-utils/richMarkdownHistory';

const originalElementFromPoint = document.elementFromPoint;
afterEach(() => { cleanup(); jest.useRealTimers(); jest.restoreAllMocks(); document.elementFromPoint = originalElementFromPoint; });

it.each([false, true])('B30 / D03 ACCEPTED COSMETIC DIFFERENCE: hides the indicator until the next dragover, then removes it on drag end, earlier typing=%s', retirement => {
  jest.useFakeTimers();
  const view = render(<RichMarkdownEditor value="Original paragraph." onChange={jest.fn()} />);
  const editor = mountedEditor(view.container);
  if (retirement) {
    typeAtEnd(editor, ' abcdef');
    view.rerender(<RichMarkdownEditor value={markdown(editor)} onChange={jest.fn()} />);
  }
  const dom = editor.view.dom;
  document.elementFromPoint = () => null;
  const parent = dom.parentElement!;
  const rect = { x: 0, y: 0, left: 0, top: 0, right: 100, bottom: 100, width: 100, height: 100, toJSON: () => ({}) };
  // jsdom has no layout; supply geometry only. The installed dropcursor plugin and DOM listeners are real.
  jest.spyOn(dom, 'getBoundingClientRect').mockReturnValue(rect);
  jest.spyOn(parent, 'getBoundingClientRect').mockReturnValue(rect);
  Object.defineProperty(dom, 'offsetParent', { configurable: true, value: parent });
  Object.defineProperty(dom, 'offsetWidth', { configurable: true, value: 100 });
  Object.defineProperty(parent, 'offsetWidth', { configurable: true, value: 100 });
  Object.defineProperty(parent, 'offsetHeight', { configurable: true, value: 100 });
  jest.spyOn(editor.view, 'posAtCoords').mockReturnValue({ pos: 1, inside: -1 });
  jest.spyOn(editor.view, 'coordsAtPos').mockReturnValue({ left: 10, right: 10, top: 10, bottom: 30 });
  const count = () => parent.querySelectorAll('.prosemirror-dropcursor-inline, .prosemirror-dropcursor-block').length;
  fireEvent.dragOver(dom, { clientX: 10, clientY: 10 });
  const before = count();
  expect(before).toBe(1);
  const arrived = retirement ? 'Original paragraph. abPHONEef' : 'Original paragraph.\n\nPhone paragraph.';
  view.rerender(<RichMarkdownEditor value={arrived} onChange={jest.fn()} />);
  expect(count()).toBe(0);
  fireEvent.dragOver(dom, { clientX: 10, clientY: 10 });
  const afterDragOver = count();
  fireEvent.dragEnd(dom);
  act(() => jest.advanceTimersByTime(50));
  const afterDragEnd = count();
  act(() => jest.advanceTimersByTime(5000));
  expect(count()).toBe(0);
  expect(afterDragOver).toBe(1);
  expect(afterDragEnd).toBe(0);
});
