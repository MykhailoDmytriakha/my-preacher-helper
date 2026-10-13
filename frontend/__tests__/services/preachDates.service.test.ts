const mockFetchCalendarSermonsViaClient = jest.fn();

jest.mock('@/services/sermons.client', () => ({
    addPreachDateViaClient: jest.fn(),
    updatePreachDateViaClient: jest.fn(),
    deletePreachDateViaClient: jest.fn(),
    fetchPreachDatesViaClient: jest.fn(),
    fetchCalendarSermonsViaClient: (...args: unknown[]) => mockFetchCalendarSermonsViaClient(...args),
}));

import { PreachDate } from '@/models/models';
import * as preachDatesService from '@/services/preachDates.service';

describe('preachDates.service', () => {
  const originalFetch = global.fetch;
    const sermonId = 'sermon-123';
    const dateId = 'date-456';

    beforeEach(() => {
        global.fetch = jest.fn();
    });

    afterEach(() => {
        global.fetch = originalFetch;
        jest.clearAllMocks();
    });

    // Sermons are engine-owned: preach dates are written only through the data engine, and the
    // legacy writers refuse before any request.
    it.each([
        ['add', () => preachDatesService.addPreachDate(sermonId, { date: '2026-08-13' } as never)],
        ['update', () => preachDatesService.updatePreachDate(sermonId, dateId, { status: 'preached' } as never)],
        ['delete', () => preachDatesService.deletePreachDate(sermonId, dateId)],
    ])('refuses a legacy %s before any request', async (_name, write) => {
        await expect(write()).rejects.toMatchObject({ code: 'data-engine-required' });
        expect(global.fetch).not.toHaveBeenCalled();
    });

    describe('fetchPreachDates', () => {
        it('successfully fetches preach dates', async () => {
            const mockDates: PreachDate[] = [{ id: dateId } as any];

            (global.fetch as jest.Mock).mockResolvedValueOnce({
                ok: true,
                json: async () => ({ preachDates: mockDates }),
            });

            const result = await preachDatesService.fetchPreachDates(sermonId);

            expect(global.fetch).toHaveBeenCalledWith(
                expect.stringContaining(`/api/sermons/${sermonId}/preach-dates`),
                expect.objectContaining({ headers: { Authorization: 'Bearer test-token' } })
            );
            expect(result).toEqual(mockDates);
        });
    });

    describe('fetchCalendarSermons', () => {
        it('fetches calendar sermons through the client SDK', async () => {
            const userId = 'user-1';
            const startDate = '2023-01-01';
            const endDate = '2023-12-31';
            const mockSermons = [{ id: 's1' }];

            mockFetchCalendarSermonsViaClient.mockResolvedValueOnce(mockSermons);

            const result = await preachDatesService.fetchCalendarSermons(userId, startDate, endDate);

            expect(mockFetchCalendarSermonsViaClient).toHaveBeenCalledWith(userId, startDate, endDate);
            expect(global.fetch).not.toHaveBeenCalled();
            expect(result).toEqual(mockSermons);
        });
    });
});
jest.mock('@/utils/authenticatedRequest', () => ({
  getAuthenticatedRequestHeaders: jest.fn().mockResolvedValue({ Authorization: 'Bearer test-token' }),
}));
