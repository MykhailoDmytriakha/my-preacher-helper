import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';

import { Chip } from '../Chip';

describe('Chip', () => {
  it('renders a plain label with no interactive role', () => {
    render(<Chip>Psalms 5:5</Chip>);

    const chip = screen.getByText('Psalms 5:5');
    expect(chip).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('gives every tone and size the same shape', () => {
    const { container: emeraldMd } = render(<Chip tone="emerald">a tag</Chip>);
    const { container: blueSm } = render(
      <Chip tone="blue" size="sm">
        a reference
      </Chip>
    );

    const shape = ['inline-flex', 'items-center', 'rounded-full', 'font-medium'];
    for (const token of shape) {
      expect(emeraldMd.firstChild).toHaveClass(token);
      expect(blueSm.firstChild).toHaveClass(token);
    }
    // Only the padding and the plate differ between the two.
    expect(emeraldMd.firstChild).toHaveClass('px-3', 'py-1', 'bg-emerald-100');
    expect(blueSm.firstChild).toHaveClass('px-2', 'py-0.5', 'bg-blue-100');
  });

  describe('when it can be pressed', () => {
    it('answers a click, Enter and Space, and says it is a button', () => {
      const onClick = jest.fn();
      render(<Chip onClick={onClick}>pick me</Chip>);

      const chip = screen.getByRole('button', { name: 'pick me' });
      expect(chip).toHaveAttribute('tabindex', '0');

      fireEvent.click(chip);
      fireEvent.keyDown(chip, { key: 'Enter' });
      fireEvent.keyDown(chip, { key: ' ' });
      expect(onClick).toHaveBeenCalledTimes(3);

      // A key that means nothing here must not fire it.
      fireEvent.keyDown(chip, { key: 'a' });
      expect(onClick).toHaveBeenCalledTimes(3);
    });

    it('says whether it is pressed, both ways', () => {
      const { rerender } = render(
        <Chip onClick={jest.fn()} selected>
          chosen
        </Chip>
      );
      expect(screen.getByRole('button', { name: 'chosen' })).toHaveAttribute('aria-pressed', 'true');

      // A toggle that DROPS the attribute when it is off stops announcing itself as a
      // toggle exactly where the state matters most.
      rerender(<Chip onClick={jest.fn()}>chosen</Chip>);
      expect(screen.getByRole('button', { name: 'chosen' })).toHaveAttribute('aria-pressed', 'false');
    });

    it('hands the event over so a chip inside a link can stop it', () => {
      const onClick = jest.fn();
      render(<Chip onClick={onClick}>inside a row</Chip>);

      fireEvent.click(screen.getByRole('button', { name: 'inside a row' }));
      expect(onClick.mock.calls[0][0]).toBeDefined();
      expect(typeof onClick.mock.calls[0][0].stopPropagation).toBe('function');
    });

    it('goes quiet when disabled', () => {
      const onClick = jest.fn();
      render(
        <Chip onClick={onClick} disabled>
          off
        </Chip>
      );

      const chip = screen.getByText('off').parentElement as HTMLElement;
      fireEvent.click(chip);
      expect(onClick).not.toHaveBeenCalled();
      expect(screen.queryByRole('button')).not.toBeInTheDocument();
    });
  });

  describe('the remove button', () => {
    it('removes without also firing the chip itself', () => {
      const onClick = jest.fn();
      const onRemove = jest.fn();
      render(
        <Chip onClick={onClick} onRemove={onRemove} removeLabel="Remove tag anger">
          anger
        </Chip>
      );

      fireEvent.click(screen.getByRole('button', { name: 'Remove tag anger' }));
      expect(onRemove).toHaveBeenCalledTimes(1);
      expect(onClick).not.toHaveBeenCalled();
    });

    it('can be reached with the keyboard even when the chip itself is pressable', () => {
      const onClick = jest.fn();
      const onRemove = jest.fn();
      render(
        <Chip onClick={onClick} onRemove={onRemove} removeLabel="Remove tag anger">
          anger
        </Chip>
      );

      // The key belongs to the ✕ under the cursor, not to the chip around it. Without
      // that, Enter on "remove" opened the editor instead of removing.
      const remove = screen.getByRole('button', { name: 'Remove tag anger' });
      fireEvent.keyDown(remove, { key: 'Enter', bubbles: true });
      expect(onClick).not.toHaveBeenCalled();
    });

    it('is absent on a disabled chip', () => {
      render(
        <Chip onRemove={jest.fn()} removeLabel="Remove" disabled>
          frozen
        </Chip>
      );

      expect(screen.queryByRole('button', { name: 'Remove' })).not.toBeInTheDocument();
    });
  });

  it('lets an abbreviation say its full name', () => {
    render(
      <Chip ariaLabel="Psalms 5 verse 5" onClick={jest.fn()}>
        Ps.5:5
      </Chip>
    );

    expect(screen.getByRole('button', { name: 'Psalms 5 verse 5' })).toBeInTheDocument();
  });

  it('leaves a hand-picked colour alone', () => {
    const { container } = render(
      <Chip tone="custom" style={{ backgroundColor: '#ff6b6b', color: '#000000' }}>
        a series
      </Chip>
    );

    const chip = container.firstChild as HTMLElement;
    expect(chip).toHaveStyle({ backgroundColor: '#ff6b6b', color: '#000000' });
    // The `custom` tone contributes no plate of its own, or it would paint over that.
    expect(chip.className).not.toMatch(/bg-(emerald|blue|gray|neutral)-\d/);
  });

  it('carries exactly one font weight, so a bold chip is really bold', () => {
    const { container: normal } = render(<Chip tone="blue">quiet</Chip>);
    const { container: loud } = render(
      <Chip tone="blue" weight="bold">
        loud
      </Chip>
    );

    // Both weights in one class list would be decided by Tailwind's own rule order, not by
    // the caller — which is how eight labels asked for bold and rendered medium.
    expect(normal.firstChild).toHaveClass('font-medium');
    expect((normal.firstChild as HTMLElement).className).not.toContain('font-bold');
    expect(loud.firstChild).toHaveClass('font-bold');
    expect((loud.firstChild as HTMLElement).className).not.toContain('font-medium');
  });

  it('says it is disabled rather than vanishing from the accessibility tree', () => {
    const { container } = render(
      <Chip onClick={jest.fn()} disabled>
        off
      </Chip>
    );

    expect(container.firstChild).toHaveAttribute('aria-disabled', 'true');
  });

  it('shows a leading glyph before the label', () => {
    render(<Chip icon={<span data-testid="chip-glyph">#</span>}>tagged</Chip>);

    expect(screen.getByTestId('chip-glyph')).toBeInTheDocument();
    expect(screen.getByText('tagged')).toBeInTheDocument();
  });
});
