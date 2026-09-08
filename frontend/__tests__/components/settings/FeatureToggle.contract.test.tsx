import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

import AudioGenerationToggle from '@/components/settings/AudioGenerationToggle';
import PrepModeToggle from '@/components/settings/PrepModeToggle';
import StructurePreviewToggle from '@/components/settings/StructurePreviewToggle';
import { persistedWrite, queuedWrite } from '@/utils/recoverableWrite';

let mockUser: { uid: string } | null;
const mockWrite = jest.fn();
let mockSettings: Record<string, boolean> | null;
let mockLoading: boolean;
jest.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: mockUser }) }));
jest.mock('@/hooks/useUserSettings', () => ({
  useUserSettings: () => ({
    settings: mockSettings, loading: mockLoading,
    updatePrepModeAccess: mockWrite,
    updateAudioGenerationAccess: mockWrite,
    updateStructurePreviewAccess: mockWrite,
  }),
}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

beforeEach(() => {
  mockUser = { uid: 'owner' };
  mockSettings = null;
  mockLoading = false;
  mockWrite.mockReset().mockImplementation(() => persistedWrite(Promise.resolve()));
});

describe.each([
  { name: 'preparation', Component: PrepModeToggle, field: 'enablePrepMode', id: 'prep-mode', key: 'prepMode',
    errorLabel: '❌ PrepModeToggle: Error updating prep mode:' },
  { name: 'audio', Component: AudioGenerationToggle, field: 'enableAudioGeneration', id: 'audio-generation', key: 'audioGeneration',
    errorLabel: 'AudioGenerationToggle: Error updating setting:' },
  { name: 'structure', Component: StructurePreviewToggle, field: 'enableStructurePreview', id: 'structure-preview', key: 'structurePreview',
    errorLabel: '❌ StructurePreviewToggle: Error updating setting:' },
])('$name settings contract', ({ Component, field, id, key, errorLabel }) => {
  it('loads once, retains the last value during refresh, then adopts refreshed settings', () => {
    mockLoading = true;
    const { rerender } = render(<Component />);
    expect(screen.getByTestId(`${id}-loading`)).toBeInTheDocument();
    expect(screen.queryByRole('switch')).not.toBeInTheDocument();
    expect(screen.queryByText(`settings.${key}.title`)).not.toBeInTheDocument();
    mockLoading = false;
    mockSettings = { [field]: true };
    rerender(<Component />);
    expect(screen.getByRole('switch')).toBeChecked();
    mockLoading = true;
    mockSettings = null;
    rerender(<Component />);
    expect(screen.getByRole('switch')).toBeChecked();
    mockLoading = false;
    rerender(<Component />);
    expect(screen.getByRole('switch')).not.toBeChecked();
  });

  it.each([false, true])('submits the inverse of %s and reflects acceptance', async (enabled) => {
    mockSettings = { [field]: enabled };
    render(<Component />);
    expect(screen.getByText(`settings.${key}.title`)).toBeInTheDocument();
    expect(screen.getByText(`settings.${key}.description`)).toBeInTheDocument();
    if (enabled) expect(screen.getByRole('switch')).toBeChecked();
    else expect(screen.getByRole('switch')).not.toBeChecked();
    fireEvent.click(screen.getByRole('switch'));
    await waitFor(() => {
      if (enabled) expect(screen.getByRole('switch')).not.toBeChecked();
      else expect(screen.getByRole('switch')).toBeChecked();
    });
    expect(mockWrite).toHaveBeenCalledWith(!enabled);
    expect(mockWrite).toHaveBeenCalledTimes(1);
  });

  it('resets on logout and never submits without an owner', () => {
    mockSettings = { [field]: true };
    const { rerender } = render(<Component />);
    mockUser = null;
    rerender(<Component />);
    expect(screen.getByRole('switch')).not.toBeChecked();
    fireEvent.click(screen.getByRole('switch'));
    expect(mockWrite).not.toHaveBeenCalled();
  });

  it.each(['immediate', 'late'])('restores the value on %s refusal', async (timing) => {
    let reject!: (reason: Error) => void;
    const request = new Promise<void>((_resolve, refuse) => { reject = refuse; });
    mockWrite.mockReturnValue(timing === 'late' ? queuedWrite('receipt', request) : persistedWrite(request));
    const errorLog = jest.spyOn(console, 'error').mockImplementation(() => {});
    const alert = jest.spyOn(window, 'alert').mockImplementation(() => {});
    const error = new Error('refused');
    try {
      render(<Component />);
      fireEvent.click(screen.getByRole('switch'));
      if (timing === 'late') await waitFor(() => expect(screen.getByRole('switch')).toBeChecked());
      await act(async () => { reject(error); });
      await waitFor(() => expect(screen.getByRole('switch')).not.toBeChecked());
      expect(errorLog).toHaveBeenCalledWith(errorLabel, error);
      expect(alert).not.toHaveBeenCalled();
    } finally {
      errorLog.mockRestore();
      alert.mockRestore();
    }
  });
});
