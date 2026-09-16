import { render, screen } from '@testing-library/react';
import React from 'react';

import SermonFormDialog from '@/components/sermon/SermonFormDialog';
import '@testing-library/jest-dom';

jest.mock('react-dom', () => ({
  ...jest.requireActual('react-dom'),
  createPortal: (element: React.ReactNode) => element,
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string; field?: string }) =>
      options?.field ? `${key}:${options.field}` : options?.defaultValue ?? key,
  }),
}));

jest.mock('@/components/church/ChurchField', () => ({
  __esModule: true,
  default: () => <div data-testid="church-field" />,
}));

jest.mock('@components/ui/DatePickerField', () => ({
  __esModule: true,
  default: () => <div data-testid="date-field" />,
}));

const renderForm = (saving: boolean) =>
  render(
    <SermonFormDialog
      heading="Новая проповедь"
      values={{ title: 'Тема', verse: 'Еф 1:15', church: undefined, plannedDate: '', seriesId: '' }}
      onChange={jest.fn()}
      onSubmit={jest.fn()}
      onCancel={jest.fn()}
      submitLabel="Сохранить"
      saving={saving}
    />
  );

/**
 * THE FOOTER MUST NOT MOVE WHEN THE BUTTON CHANGES ITS MIND.
 *
 * "Сохранить" becomes "Сохранение…" mid-save, and the button grew by a third — which slid
 * Cancel sideways under the person's finger and, caught mid-repaint, looked like two footers
 * printed on top of each other. The button keeps its size and only its contents change.
 */
describe('the save button holds its ground while it saves', () => {
  it('reserves the room the longest wording needs, so nothing shifts', () => {
    const { unmount } = renderForm(false);
    const idle = screen.getByRole('button', { name: 'Сохранить' });
    expect(idle.className).toContain('min-w-');
    unmount();

    renderForm(true);
    const busy = screen.getByRole('button', { name: /Saving/ });
    expect(busy.className).toContain('min-w-');
  });

  it('keeps the wording in one place, so the two states cannot overlap', () => {
    renderForm(true);

    const labels = screen.getAllByText(/Сохранить|Saving/);
    expect(labels).toHaveLength(1);
  });

  it('tells assistive tech the save is running', () => {
    renderForm(true);

    expect(screen.getByRole('button', { name: /Saving/ })).toHaveAttribute('aria-busy', 'true');
  });
});
