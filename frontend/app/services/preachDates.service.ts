import { PreachDate, Sermon } from '@/models/models';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE || '';

export async function addPreachDate(sermonId: string, data: Omit<PreachDate, 'id' | 'createdAt'>): Promise<PreachDate> {
    const response = await fetch(`${API_BASE}/api/sermons/${sermonId}/preach-dates`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
    });
    if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to add preach date');
    }
    const result = await response.json();
    return result.preachDate;
}

export async function updatePreachDate(sermonId: string, dateId: string, updates: Partial<PreachDate>): Promise<PreachDate> {
    const response = await fetch(`${API_BASE}/api/sermons/${sermonId}/preach-dates/${dateId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
    });
    if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to update preach date');
    }
    const result = await response.json();
    return result.preachDate;
}

export async function deletePreachDate(sermonId: string, dateId: string): Promise<void> {
    const response = await fetch(`${API_BASE}/api/sermons/${sermonId}/preach-dates/${dateId}`, {
        method: 'DELETE',
    });
    if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to delete preach date');
    }
}

export async function fetchPreachDates(sermonId: string): Promise<PreachDate[]> {
    const response = await fetch(`${API_BASE}/api/sermons/${sermonId}/preach-dates`);
    if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to fetch preach dates');
    }
    const result = await response.json();
    return result.preachDates;
}

export async function fetchCalendarSermons(userId: string, startDate?: string, endDate?: string): Promise<Sermon[]> {
    const params = new URLSearchParams({ userId });
    if (startDate) params.append('startDate', startDate);
    if (endDate) params.append('endDate', endDate);

    const response = await fetch(`${API_BASE}/api/calendar/sermons?${params.toString()}`);
    if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to fetch calendar sermons');
    }
    const result = await response.json();
    return result.sermons;
}
