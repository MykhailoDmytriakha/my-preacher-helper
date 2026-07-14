import { PreachDate, Sermon } from '@/models/models';
import { fetchCalendarSermonsViaClient } from '@/services/sermons.client';
import { getAuthenticatedRequestHeaders } from '@/utils/authenticatedRequest';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE || '';

export async function addPreachDate(sermonId: string, data: Omit<PreachDate, 'id' | 'createdAt'> & { id?: string }): Promise<PreachDate> {
    const authHeaders = await getAuthenticatedRequestHeaders();
    const response = await fetch(`${API_BASE}/api/sermons/${sermonId}/preach-dates`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
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
    const authHeaders = await getAuthenticatedRequestHeaders();
    const response = await fetch(`${API_BASE}/api/sermons/${sermonId}/preach-dates/${dateId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
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
    const authHeaders = await getAuthenticatedRequestHeaders();
    const response = await fetch(`${API_BASE}/api/sermons/${sermonId}/preach-dates/${dateId}`, {
        method: 'DELETE',
        headers: authHeaders,
    });
    if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to delete preach date');
    }
}

export async function fetchPreachDates(sermonId: string): Promise<PreachDate[]> {
    const authHeaders = await getAuthenticatedRequestHeaders();
    const response = await fetch(`${API_BASE}/api/sermons/${sermonId}/preach-dates`, { headers: authHeaders });
    if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to fetch preach dates');
    }
    const result = await response.json();
    return result.preachDates;
}

export async function fetchCalendarSermons(userId: string, startDate?: string, endDate?: string): Promise<Sermon[]> {
    return fetchCalendarSermonsViaClient(userId, startDate, endDate);
}
