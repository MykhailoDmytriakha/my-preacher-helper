import { cleanup, render } from '@testing-library/react';
import { StrictMode, useRef } from 'react';

import { useWorkspacePanes } from '@/hooks/useWorkspacePanes';

function Holder({ active = true, kind = 'reader' }: { active?: boolean; kind?: 'reader' | 'study' }) {
  const content = useRef<HTMLDivElement | null>(null);
  useWorkspacePanes(content, kind, active);
  return <div ref={content}>Pane content</div>;
}

let shell: HTMLDivElement;
let workspace: HTMLDivElement;
beforeEach(() => {
  shell = document.createElement('div');
  shell.id = 'app-shell';
  workspace = document.createElement('div');
  workspace.dataset.pageGesture = 'idle';
  shell.append(workspace);
  document.body.append(shell);
});
afterEach(() => { cleanup(); shell.remove(); });

it('acquires and releases both owners when the active mode changes', () => {
  const view = render(<Holder active={false} />, { container: workspace });
  expect(shell).not.toHaveAttribute('data-reader-layout');
  view.rerender(<Holder active />);
  expect(shell).toHaveAttribute('data-reader-layout', '');
  expect(workspace).toHaveAttribute('data-reader-layout', '');
  view.rerender(<Holder active={false} />);
  expect(shell).not.toHaveAttribute('data-reader-layout');
  expect(workspace).not.toHaveAttribute('data-reader-layout');
});

it('keeps the layout until its last overlapping holder leaves', () => {
  const holders = (ids: string[]) => <>{ids.map(id => <Holder key={id} />)}</>;
  const view = render(holders(['first', 'second']), { container: workspace });
  view.rerender(holders(['second']));
  expect(shell).toHaveAttribute('data-reader-layout');
  expect(workspace).toHaveAttribute('data-reader-layout');
  view.rerender(holders([]));
  expect(shell).not.toHaveAttribute('data-reader-layout');
  expect(workspace).not.toHaveAttribute('data-reader-layout');
});

it('keeps reader and study claims independent', () => {
  const view = render(<><Holder key="reader" /><Holder key="study" kind="study" /></>, { container: workspace });
  view.rerender(<><Holder key="study" kind="study" /></>);
  expect(shell).not.toHaveAttribute('data-reader-layout');
  expect(shell).toHaveAttribute('data-study-layout');
  view.unmount();
  expect(shell).not.toHaveAttribute('data-study-layout');
});

it('restores both preexisting attribute values', () => {
  shell.setAttribute('data-reader-layout', 'shell-before');
  workspace.setAttribute('data-reader-layout', 'workspace-before');
  const view = render(<Holder />, { container: workspace });
  expect(shell).toHaveAttribute('data-reader-layout', '');
  view.unmount();
  expect(shell).toHaveAttribute('data-reader-layout', 'shell-before');
  expect(workspace).toHaveAttribute('data-reader-layout', 'workspace-before');
});

it('leaves no claim after StrictMode replays and unmounts effects', () => {
  const view = render(<StrictMode><Holder /></StrictMode>, { container: workspace });
  expect(shell).toHaveAttribute('data-reader-layout');
  view.unmount();
  expect(shell).not.toHaveAttribute('data-reader-layout');
  expect(workspace).not.toHaveAttribute('data-reader-layout');
});

it('does not claim a preview outside the direct private shell', () => {
  const wrapper = document.createElement('div');
  shell.replaceChildren(wrapper);
  wrapper.append(workspace);
  render(<Holder />, { container: workspace });
  expect(shell).not.toHaveAttribute('data-reader-layout');
  expect(workspace).not.toHaveAttribute('data-reader-layout');
});
