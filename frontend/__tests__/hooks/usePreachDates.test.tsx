import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { usePreachDates } from '@/hooks/usePreachDates';
import * as preachDatesService from '@services/preachDates.service';
import { PreachDate } from '@/models/models';
import type { ReactNode } from 'react';

// Mock the service
jest.mock('@services/preachDates.service', () => ({
    fetchPreachDates: jest.fn(),
    addPreachDate: jest.fn(),
    updatePreachDate: jest.fn(),
    deletePreachDate: jest.fn(),
}));

const mockFetchPreachDates = preachDatesService.fetchPreachDates as jest.Mock;
const mockAddPreachDate = preachDatesService.addPreachDate as jest.Mock;
const mockUpdatePreachDate = preachDatesService.updatePreachDate as jest.Mock;
const mockDeletePreachDate = preachDatesService.deletePreachDate as jest.Mock;

const createWrapper = () => {
    const queryClient = new QueryClient({
        defaultOptions: {
            queries: { retry: false },
        },
    });
    return ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
};

describe('usePreachDates', () => {
    const sermonId = 'sermon-1';
    const mockDates: PreachDate[] = [
        { id: 'd1', date: '2023-10-27', church: { id: 'c1', name: 'Zion' }, createdAt: '2023-10-27T10:00:00Z' }
    ];

    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('fetches preach dates for a given sermonId', async () => {
        mockFetchPreachDates.mockResolvedValue(mockDates);

        const { result } = renderHook(() => usePreachDates(sermonId), { wrapper: createWrapper() });

        expect(result.current.isLoading).toBe(true);

        await waitFor(() => {
            expect(result.current.isLoading).toBe(false);
        });

        expect(result.current.preachDates).toEqual(mockDates);
        expect(mockFetchPreachDates).toHaveBeenCalledWith(sermonId);
    });

    it('returns queued acceptance for a durable add mutation and keeps its client id for replay', async () => {
        const newDate = { date: '2023-11-01', church: { id: 'c1', name: 'Zion' } };
        mockAddPreachDate.mockResolvedValue({ id: 'd2', ...newDate, createdAt: '...' });

        const { result } = renderHook(() => usePreachDates(sermonId), { wrapper: createWrapper() });

        const submission = result.current.addDate(newDate);
        await expect(submission.acceptance).resolves.toMatchObject({ kind: 'queued' });

        await waitFor(() => {
            expect(mockAddPreachDate).toHaveBeenCalledWith(
                sermonId,
                expect.objectContaining({ ...newDate, id: expect.any(String) })
            );
        });
    });

    it('returns queued acceptance for a durable update mutation', async () => {
        const updates = { audience: 'Everyone' };
        mockUpdatePreachDate.mockResolvedValue({ id: 'd1', ...updates });

        const { result } = renderHook(() => usePreachDates(sermonId), { wrapper: createWrapper() });

        const submission = result.current.updateDate({ dateId: 'd1', updates });
        await expect(submission.acceptance).resolves.toMatchObject({ kind: 'queued' });

        await waitFor(() => {
            expect(mockUpdatePreachDate).toHaveBeenCalledWith(sermonId, 'd1', updates);
        });
    });

    it('returns queued acceptance for a durable delete mutation', async () => {
        mockDeletePreachDate.mockResolvedValue(undefined);

        const { result } = renderHook(() => usePreachDates(sermonId), { wrapper: createWrapper() });

        const submission = result.current.deleteDate('d1');
        await expect(submission.acceptance).resolves.toMatchObject({ kind: 'queued' });

        await waitFor(() => {
            expect(mockDeletePreachDate).toHaveBeenCalledWith(sermonId, 'd1');
        });
    });
});
