import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import React from 'react';

import '@testing-library/jest-dom';

import type { User } from 'firebase/auth';
import type { PlanTemplate } from '@/models/models';

const mockCreate = jest.fn().mockResolvedValue(undefined);
const mockUpdate = jest.fn().mockResolvedValue(undefined);
const mockDelete = jest.fn().mockResolvedValue(undefined);
let mockTemplates: PlanTemplate[] = [];

jest.mock('@/hooks/usePlanTemplates', () => ({
  usePlanTemplates: () => ({
    templates: mockTemplates,
    loading: false,
    createTemplate: mockCreate,
    updateTemplate: mockUpdate,
    deleteTemplate: mockDelete,
  }),
}));

jest.mock('sonner', () => ({ toast: { success: jest.fn(), error: jest.fn() } }));

// headless-ui Dialog/Transition is awkward in jsdom; stub the confirm dialog to a
// minimal passthrough so we test OUR wiring (open -> confirm -> delete), not the lib.
jest.mock('@/components/ui/ConfirmModal', () => {
  const React = require('react');
  return {
    __esModule: true,
    default: ({ isOpen, onConfirm, onClose, title, confirmText }: { isOpen: boolean; onConfirm: () => void; onClose: () => void; title: string; confirmText?: string }) =>
      isOpen
        ? React.createElement(
            'div',
            { role: 'dialog' },
            React.createElement('span', null, title),
            React.createElement('button', { onClick: onConfirm }, confirmText),
            React.createElement('button', { onClick: onClose }, 'cancel-mock')
          )
        : null,
  };
});

import PlanTemplatesSection from '@/components/settings/PlanTemplatesSection';

const user = { uid: 'u1' } as unknown as User;

const tpl = (id: string, name: string, points = 0): PlanTemplate => ({
  id,
  userId: 'u1',
  name,
  structure: {
    introduction: Array.from({ length: points }, (_, i) => ({ id: `${id}-i${i}`, text: `p${i}` })),
    main: [],
    conclusion: [],
  },
  createdAt: '2026-06-01T00:00:00.000Z',
  updatedAt: '2026-06-01T00:00:00.000Z',
});

beforeEach(() => {
  jest.clearAllMocks();
  mockTemplates = [];
});
afterEach(cleanup);

describe('PlanTemplatesSection', () => {
  it('creates a template with a client id, the user id and an empty structure', async () => {
    render(<PlanTemplatesSection user={user} />);

    const input = screen.getByPlaceholderText('planTemplates.createPlaceholder');
    fireEvent.change(input, { target: { value: 'Parable analysis' } });
    fireEvent.click(screen.getByText('planTemplates.create'));

    await waitFor(() => expect(mockCreate).toHaveBeenCalledTimes(1));
    const payload = mockCreate.mock.calls[0][0];
    expect(payload).toEqual(
      expect.objectContaining({ userId: 'u1', name: 'Parable analysis' })
    );
    expect(payload.id).toBeTruthy();
    expect(payload.structure).toEqual({ introduction: [], main: [], conclusion: [] });
  });

  it('lists existing templates with their point counts', () => {
    mockTemplates = [tpl('t1', 'Alpha', 3), tpl('t2', 'Beta', 1)];
    render(<PlanTemplatesSection user={user} />);
    expect(screen.getByText('Alpha')).toBeInTheDocument();
    expect(screen.getByText('Beta')).toBeInTheDocument();
    expect(screen.getByText(/^3 /)).toBeInTheDocument();
  });

  it('deletes a template after confirming in the dialog', async () => {
    mockTemplates = [tpl('t1', 'Alpha', 2)];
    render(<PlanTemplatesSection user={user} />);

    fireEvent.click(screen.getByLabelText('common.delete')); // opens the ConfirmModal
    const confirmBtn = await screen.findByText('common.delete'); // dialog confirm button (text)
    fireEvent.click(confirmBtn);

    await waitFor(() => expect(mockDelete).toHaveBeenCalledWith('t1'));
  });

  it('renames a template', async () => {
    mockTemplates = [tpl('t1', 'Alpha', 0)];
    render(<PlanTemplatesSection user={user} />);

    fireEvent.click(screen.getByLabelText('common.edit'));
    const input = screen.getByDisplayValue('Alpha');
    fireEvent.change(input, { target: { value: 'Alpha renamed' } });
    fireEvent.click(screen.getByLabelText('common.save'));

    await waitFor(() => expect(mockUpdate).toHaveBeenCalledWith('t1', { name: 'Alpha renamed' }));
  });
});
