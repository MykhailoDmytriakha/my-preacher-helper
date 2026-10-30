import { fireEvent, render, screen } from '@testing-library/react';
import { useRef } from 'react';

import { useUndoShortcut } from '@/components/bible/analysis/useUndoShortcut';
import { useModalLayer } from '@/hooks/useModalLayer';

function Screen({ active = true, undo }: { active?: boolean; undo: () => void }) {
  const scope = useRef<HTMLDivElement>(null);
  const layer = useModalLayer({ onClose: () => undefined });
  useUndoShortcut(active, undo, scope);
  return <div {...layer} role="dialog" aria-label="analysis"><div ref={scope}><input aria-label="typing" /></div></div>;
}

function Over() {
  const layer = useModalLayer({ onClose: () => undefined });
  return <div {...layer} role="dialog" aria-label="over">over</div>;
}

describe('⌘Z in an analysis being edited', () => {
  it('undoes with ⌘Z and with Ctrl+Z, known by the key\'s place, not its letter', () => {
    const undo = jest.fn();
    render(<Screen undo={undo} />);
    fireEvent.keyDown(document, { code: 'KeyZ', key: 'я', metaKey: true });
    fireEvent.keyDown(document, { code: 'KeyZ', key: 'z', ctrlKey: true });
    expect(undo).toHaveBeenCalledTimes(2);
  });

  it('leaves alone ⇧⌘Z, a plain Z, typing in a field, a window over it, and «Просмотр»', () => {
    const undo = jest.fn();
    const { rerender } = render(<Screen undo={undo} />);
    fireEvent.keyDown(document, { code: 'KeyZ', key: 'z', metaKey: true, shiftKey: true });
    fireEvent.keyDown(document, { code: 'KeyZ', key: 'z' });
    fireEvent.keyDown(screen.getByLabelText('typing'), { code: 'KeyZ', key: 'z', metaKey: true });
    rerender(<><Screen undo={undo} /><Over /></>);
    fireEvent.keyDown(document, { code: 'KeyZ', key: 'z', metaKey: true });
    rerender(<Screen undo={undo} active={false} />);
    fireEvent.keyDown(document, { code: 'KeyZ', key: 'z', metaKey: true });
    expect(undo).not.toHaveBeenCalled();
  });
});
