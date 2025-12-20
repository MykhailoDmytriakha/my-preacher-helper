import * as preachDatesService from '@/services/preachDates.service';
import { PreachDate } from '@/models/models';

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

    describe('addPreachDate', () => {
        it('successfully adds a preach date', async () => {
            const newDate: Omit<PreachDate, 'id' | 'createdAt'> = {
                date: '2023-10-27',
                church: { id: 'c1', name: 'Zion', city: 'Kyiv' }
            };
            const mockResponse: PreachDate = { ...newDate, id: dateId, createdAt: '2023-10-27T10:00:00Z' };

            (global.fetch as jest.Mock).mockResolvedValueOnce({
                ok: true,
                json: async () => ({ preachDate: mockResponse }),
            });

            const result = await preachDatesService.addPreachDate(sermonId, newDate);

            expect(global.fetch).toHaveBeenCalledWith(
                expect.stringContaining(`/api/sermons/${sermonId}/preach-dates`),
                expect.objectContaining({
                    method: 'POST',
                    body: JSON.stringify(newDate),
                })
            );
            expect(result).toEqual(mockResponse);
        });

        it('throws error when API returns error', async () => {
            (global.fetch as jest.Mock).mockResolvedValueOnce({
                ok: false,
                json: async () => ({ error: 'Invalid data' }),
            });

            await expect(preachDatesService.addPreachDate(sermonId, {} as any))
                .rejects.toThrow('Invalid data');
        });
    });

    describe('updatePreachDate', () => {
        it('successfully updates a preach date', async () => {
            const updates: Partial<PreachDate> = { audience: 'Youth' };
            const mockResponse: PreachDate = {
                id: dateId,
                date: '2023-10-27',
                church: { id: 'c1', name: 'Zion' },
                createdAt: '2023-10-27T10:00:00Z',
                ...updates
            };

            (global.fetch as jest.Mock).mockResolvedValueOnce({
                ok: true,
                json: async () => ({ preachDate: mockResponse }),
            });

            const result = await preachDatesService.updatePreachDate(sermonId, dateId, updates);

            expect(global.fetch).toHaveBeenCalledWith(
                expect.stringContaining(`/api/sermons/${sermonId}/preach-dates/${dateId}`),
                expect.objectContaining({
                    method: 'PUT',
                    body: JSON.stringify(updates),
                })
            );
            expect(result).toEqual(mockResponse);
        });
    });

    describe('deletePreachDate', () => {
        it('successfully deletes a preach date', async () => {
            (global.fetch as jest.Mock).mockResolvedValueOnce({
                ok: true,
            });

            await preachDatesService.deletePreachDate(sermonId, dateId);

            expect(global.fetch).toHaveBeenCalledWith(
                expect.stringContaining(`/api/sermons/${sermonId}/preach-dates/${dateId}`),
                expect.objectContaining({
                    method: 'DELETE',
                })
            );
        });
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
                expect.stringContaining(`/api/sermons/${sermonId}/preach-dates`)
            );
            expect(result).toEqual(mockDates);
        });
    });

    describe('fetchCalendarSermons', () => {
        it('successfully fetches calendar sermons with params', async () => {
            const userId = 'user-1';
            const startDate = '2023-01-01';
            const endDate = '2023-12-31';
            const mockSermons = [{ id: 's1' }];

            (global.fetch as jest.Mock).mockResolvedValueOnce({
                ok: true,
                json: async () => ({ sermons: mockSermons }),
            });

            const result = await preachDatesService.fetchCalendarSermons(userId, startDate, endDate);

            expect(global.fetch).toHaveBeenCalledWith(
                expect.stringMatching(/\/api\/calendar\/sermons\?userId=user-1&startDate=2023-01-01&endDate=2023-12-31/)
            );
            expect(result).toEqual(mockSermons);
        });
    });
});
