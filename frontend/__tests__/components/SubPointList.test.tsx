import { render, screen } from '@testing-library/react';

import { SubPointList } from '@/components/column/SubPointList';

const t = (key: string, options?: Record<string, unknown>) =>
  typeof options?.defaultValue === 'string' ? options.defaultValue : key;

describe('SubPointList', () => {
  it('uses readable dark-mode styling for sub-point labels on colored focus backgrounds', () => {
    render(
      <SubPointList
        subPoints={[{ id: 'sub-1', text: 'Saul', position: 1000 }]}
        outlinePointId="point-1"
        isPointLocked={false}
        onAdd={jest.fn()}
        onEdit={jest.fn()}
        onDelete={jest.fn()}
        t={t}
      />
    );

    const label = screen.getByText('Saul');
    expect(label).toHaveClass('dark:text-blue-50/90');
    expect(label).toHaveClass('font-medium');

    const list = label.closest('div.ml-7');
    expect(list).toHaveClass('dark:bg-white/[0.07]');
    expect(list).toHaveClass('dark:border-blue-100/35');
  });
});
