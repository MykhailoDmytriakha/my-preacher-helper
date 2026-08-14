import { PreachDate, Sermon } from '@/models/models';
import { fetchCalendarSermonsViaClient } from '@/services/sermons.client';
import { getAuthenticatedRequestHeaders } from '@/utils/authenticatedRequest';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE || '';

type ApiErrorPayload = { error?: unknown; code?: unknown };

const REFUSAL_CODE_BY_STATUS: Record<number, string> = {
    400: 'invalid-argument',
    401: 'unauthenticated',
    403: 'permission-denied',
    404: 'not-found',
    409: 'already-exists',
    412: 'failed-precondition',
    // Too large is permanent for this payload: retrying sends the same bytes again.
    413: 'invalid-argument',
    501: 'unimplemented',
};

async function throwResponseError(response: Response, fallbackMessage: string): Promise<never> {
    // A proxy or gateway can answer 403/413 with HTML or nothing at all. Parsing that
    // straight threw a SyntaxError, which carries neither status nor code — so a refusal
    // was misread as a transient error and the person was told to keep retrying.
    // Every sibling service already guards this way.
    const payload = (await response.json().catch(() => null)) as ApiErrorPayload | null;
    const error = new Error(typeof payload?.error === 'string' ? payload.error : fallbackMessage);
    const code = typeof payload?.code === 'string'
        ? payload.code
        : REFUSAL_CODE_BY_STATUS[response.status];
    Object.assign(error, { status: response.status, ...(code ? { code } : {}) });
    throw error;
}

export async function addPreachDate(sermonId: string, data: Omit<PreachDate, 'id' | 'createdAt'> & { id?: string }): Promise<PreachDate> {
    const authHeaders = await getAuthenticatedRequestHeaders();
    const response = await fetch(`${API_BASE}/api/sermons/${sermonId}/preach-dates`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify(data),
    });
    if (!response.ok) {
        await throwResponseError(response, 'Failed to add preach date');
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
        await throwResponseError(response, 'Failed to update preach date');
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
        await throwResponseError(response, 'Failed to delete preach date');
    }
}

export async function fetchPreachDates(sermonId: string): Promise<PreachDate[]> {
    const authHeaders = await getAuthenticatedRequestHeaders();
    const response = await fetch(`${API_BASE}/api/sermons/${sermonId}/preach-dates`, { headers: authHeaders });
    if (!response.ok) {
        await throwResponseError(response, 'Failed to fetch preach dates');
    }
    const result = await response.json();
    return result.preachDates;
}

export async function fetchCalendarSermons(userId: string, startDate?: string, endDate?: string): Promise<Sermon[]> {
    return fetchCalendarSermonsViaClient(userId, startDate, endDate);
}
