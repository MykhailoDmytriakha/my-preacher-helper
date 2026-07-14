import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';

import { aiFunctionIds, getFunctionCatalog, getFunctionDefault } from '@/api/clients/ai/functionCatalog';
import ModelSelector from '@/components/settings/ModelSelector';
import { useUserEntitlement } from '@/hooks/useUserEntitlement';
import { useUserSettings } from '@/hooks/useUserSettings';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
jest.mock('@/hooks/useUserEntitlement', () => ({ useUserEntitlement: jest.fn() }));
jest.mock('@/hooks/useUserSettings', () => ({ useUserSettings: jest.fn() }));

const mockUseUserEntitlement = useUserEntitlement as jest.MockedFunction<typeof useUserEntitlement>;
const mockUseUserSettings = useUserSettings as jest.MockedFunction<typeof useUserSettings>;
const updateFunctionModelPreference = jest.fn();
const user = { uid: 'user-1' } as never;

const usage = {
  aiLimit: 100, aiUsed: 0, aiRemaining: 100,
  transcriptionSecondsLimit: 3600, transcriptionSecondsUsed: 0, transcriptionSecondsRemaining: 3600,
  aiBlocked: false, transcriptionBlocked: false, periodResets: false,
};

const functionsForTier = (free: boolean) => Object.fromEntries(aiFunctionIds.map((fn) => {
  const defaultModel = getFunctionDefault(fn);
  return [fn, {
    available: free ? [defaultModel] : getFunctionCatalog(fn),
    current: { providerId: defaultModel.providerId, modelId: defaultModel.modelId },
  }];
}));

describe('ModelSelector', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseUserSettings.mockReturnValue({
      settings: null,
      updateFunctionModelPreference,
      updatingFunctionModelPreference: false,
    } as unknown as ReturnType<typeof useUserSettings>);
  });

  it('renders all three functions with provider tags and five-segment quality/cost bars', () => {
    mockUseUserEntitlement.mockReturnValue({
      data: { effectiveTier: 'tier2', functions: functionsForTier(false), usage, limits: { aiCallsPerPeriod: 100, transcriptionSecondsPerPeriod: 3600 }, paidTier: 'tier2' }, isLoading: false, isError: false,
    } as unknown as ReturnType<typeof useUserEntitlement>);

    render(<ModelSelector user={user} />);

    expect(screen.getByRole('heading', { name: /functions\.transcription\.title/ })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /functions\.text\.title/ })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /functions\.tts\.title/ })).toBeInTheDocument();
    const headings = screen.getAllByRole('heading', { level: 3 });
    expect(headings.map(heading => heading.textContent)).toEqual([
      'settings.modelSelector.functions.text.title',
      'settings.modelSelector.functions.transcription.title',
      'settings.modelSelector.functions.tts.title',
    ]);
    expect(screen.getAllByText('settings.modelSelector.providers.openrouter').length).toBeGreaterThan(0);
    expect(screen.getAllByTestId('quality-bar')).toHaveLength(9);
    expect(screen.getAllByTestId('cost-bar')).toHaveLength(9);
    expect(screen.getAllByTestId('quality-bar')[0].querySelectorAll('i')).toHaveLength(5);
    expect(screen.queryByLabelText('settings.modelSelector.tierToggleLabel')).not.toBeInTheDocument();
    for (const priceLabel of new Set(aiFunctionIds.flatMap((fn) =>
      getFunctionCatalog(fn).map((entry) => entry.priceLabel)))) {
      expect(screen.queryByText(priceLabel)).not.toBeInTheDocument();
    }
  });

  it('renders loading (not a crash) when a stale cache hydrates an old shape without functions', () => {
    // Regression: a persisted React Query cache written before per-function models lacks
    // `functions`; the component must not read `entitlement.functions[fn]` and crash.
    mockUseUserEntitlement.mockReturnValue({
      data: { effectiveTier: 'free', paidTier: 'free' }, isLoading: false, isError: false,
    } as unknown as ReturnType<typeof useUserEntitlement>);

    expect(() => render(<ModelSelector user={user} />)).not.toThrow();
    expect(screen.getByTestId('model-selector-loading')).toBeInTheDocument();
  });

  it('persists a paid selection for its own function', async () => {
    mockUseUserEntitlement.mockReturnValue({
      data: { effectiveTier: 'tier2', functions: functionsForTier(false), usage, limits: { aiCallsPerPeriod: 100, transcriptionSecondsPerPeriod: 3600 }, paidTier: 'tier2' }, isLoading: false, isError: false,
    } as unknown as ReturnType<typeof useUserEntitlement>);
    updateFunctionModelPreference.mockResolvedValue(undefined);

    render(<ModelSelector user={user} />);
    fireEvent.click(screen.getByRole('radio', { name: /deepseek\/deepseek-v4-pro/ }));

    await waitFor(() => expect(updateFunctionModelPreference).toHaveBeenCalledWith({
      preferredText: { providerId: 'openrouter', modelId: 'deepseek/deepseek-v4-pro' },
    }));

    fireEvent.click(screen.getByRole('radio', { name: /gpt-4o-mini-transcribe/ }));
    await waitFor(() => expect(updateFunctionModelPreference).toHaveBeenCalledWith({
      preferredTranscription: { providerId: 'openai', modelId: 'gpt-4o-mini-transcribe' },
    }));

    fireEvent.click(screen.getByRole('radio', { name: /gpt-4o-mini-tts/ }));
    await waitFor(() => expect(updateFunctionModelPreference).toHaveBeenCalledWith({
      preferredTts: { providerId: 'openai', modelId: 'gpt-4o-mini-tts' },
    }));
  });

  it('keeps free defaults active while showing every other catalog row as locked', () => {
    mockUseUserEntitlement.mockReturnValue({
      data: { effectiveTier: 'free', functions: functionsForTier(true), usage, limits: { aiCallsPerPeriod: 100, transcriptionSecondsPerPeriod: 3600 }, paidTier: 'free' }, isLoading: false, isError: false,
    } as unknown as ReturnType<typeof useUserEntitlement>);

    render(<ModelSelector user={user} />);

    expect(screen.getAllByRole('radio')).toHaveLength(9);
    expect(screen.getAllByRole('radio', { checked: true })).toHaveLength(3);
    expect(screen.getAllByTestId('selected-radio-indicator')).toHaveLength(3);
    expect(screen.getAllByTestId('selected-radio-indicator')[0].firstElementChild).toHaveClass('bg-blue-600');
    expect(screen.getAllByText('settings.modelSelector.paidLocked')).toHaveLength(6);
    expect(screen.getByText('settings.modelSelector.freeHint')).toBeInTheDocument();
  });
});
