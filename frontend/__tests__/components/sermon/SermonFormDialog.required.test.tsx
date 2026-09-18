import { fireEvent, render, screen } from '@testing-library/react';
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

const renderForm = (
  values: Partial<React.ComponentProps<typeof SermonFormDialog>['values']> = {},
  props: Partial<React.ComponentProps<typeof SermonFormDialog>> = {}
) => {
  const onSubmit = jest.fn((event: React.FormEvent) => event.preventDefault());
  render(
    <SermonFormDialog
      heading="Новая проповедь"
      values={{ title: 'Тема', verse: 'Еф 1:15', church: undefined, plannedDate: '', seriesId: '', ...values }}
      onChange={jest.fn()}
      onSubmit={onSubmit}
      onCancel={jest.fn()}
      submitLabel="Сохранить"
      saving={false}
      {...props}
    />
  );
  return { onSubmit };
};

const save = () => fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));

describe('the sermon form never refuses in silence', () => {
  it('says which field is missing instead of letting the browser block the save invisibly', () => {
    const { onSubmit } = renderForm({ verse: '' });

    save();

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('addSermon.verseLabel');
  });

  it('names the first missing field, not the last one', () => {
    renderForm({ title: '   ', verse: '' });

    save();

    expect(screen.getByRole('alert')).toHaveTextContent('addSermon.titleLabel');
  });

  it('puts the person back in the field that is missing', () => {
    renderForm({ verse: '' });

    save();

    expect(document.activeElement).toBe(screen.getByLabelText(/addSermon.verseLabel/));
  });

  it('marks a required field as required for assistive tech, without the native popup', () => {
    renderForm();

    const verse = screen.getByLabelText(/addSermon.verseLabel/);
    expect(verse).toHaveAttribute('aria-required', 'true');
    expect(verse).not.toHaveAttribute('required');
  });

  it('submits and forgets its complaint once the field is filled', () => {
    const onSubmit = jest.fn((event: React.FormEvent) => event.preventDefault());
    const { rerender } = render(
      <SermonFormDialog
        heading="Новая проповедь"
        values={{ title: 'Тема', verse: '', church: undefined, plannedDate: '', seriesId: '' }}
        onChange={jest.fn()}
        onSubmit={onSubmit}
        onCancel={jest.fn()}
        submitLabel="Сохранить"
        saving={false}
      />
    );
    save();
    expect(screen.getByRole('alert')).toBeInTheDocument();

    rerender(
      <SermonFormDialog
        heading="Новая проповедь"
        values={{ title: 'Тема', verse: 'Еф 1:15', church: undefined, plannedDate: '', seriesId: '' }}
        onChange={jest.fn()}
        onSubmit={onSubmit}
        onCancel={jest.fn()}
        submitLabel="Сохранить"
        saving={false}
      />
    );
    save();

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});

describe('the series field says when it does not know yet', () => {
  it('tells the person the series are still loading instead of offering only "no series"', () => {
    renderForm({}, { seriesOptions: [], seriesLoading: true });

    expect(screen.getByText('workspaces.series.loadingSeries')).toBeInTheDocument();
  });

  it('offers the series once they arrive', () => {
    renderForm({}, { seriesOptions: [{ id: 's1', label: '11N' }], seriesLoading: false });

    expect(screen.getByRole('option', { name: '11N' })).toBeInTheDocument();
    expect(screen.queryByText('workspaces.series.loadingSeries')).not.toBeInTheDocument();
  });
});
