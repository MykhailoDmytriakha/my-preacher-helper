import { Series } from '@/models/models';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE;

export const getAllSeries = async (userId: string): Promise<Series[]> => {
  try {
    const response = await fetch(`${API_BASE}/api/series?userId=${userId}`, {
      cache: "no-store"
    });

    if (!response.ok) {
      console.error(`getAllSeries: Response not ok, status: ${response.status}`);
      throw new Error('Failed to fetch series');
    }

    const data = await response.json();
    return data.sort((a: Series, b: Series) => {
      // Sort by start date (desc), then by title
      const aDate = a.startDate ? new Date(a.startDate).getTime() : 0;
      const bDate = b.startDate ? new Date(b.startDate).getTime() : 0;

      if (aDate !== bDate) {
        return bDate - aDate;
      }

      return (a.title || '').localeCompare(b.title || '');
    });
  } catch (error) {
    console.error('getAllSeries: Error fetching series:', error);
    return [];
  }
};

export const getSeriesById = async (seriesId: string): Promise<Series | undefined> => {
  try {
    const response = await fetch(`${API_BASE}/api/series/${seriesId}`);

    if (!response.ok) {
      console.error(`getSeriesById: Response not ok for id ${seriesId}, status: ${response.status}`);
      throw new Error('Failed to fetch series');
    }

    const data = await response.json();
    return data;
  } catch (error) {
    console.error(`getSeriesById: Error fetching series ${seriesId}:`, error);
    return undefined;
  }
};

export const createSeries = async (series: Omit<Series, 'id'>): Promise<Series> => {
  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    const response = await fetch(`${API_BASE}/api/series`, {
      method: 'POST',
      headers,
      body: JSON.stringify(series),
    });

    if (!response.ok) {
      console.error("createSeries: Response not ok, status:", response.status);
      throw new Error('Failed to create series');
    }

    const data = await response.json();
    return data.series;
  } catch (error) {
    console.error('createSeries: Error creating series:', error);
    throw error;
  }
};

export const updateSeries = async (seriesId: string, updates: Partial<Series>): Promise<Series> => {
  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    const response = await fetch(`${API_BASE}/api/series/${seriesId}`, {
      method: 'PUT',
      headers,
      body: JSON.stringify(updates),
    });

    if (!response.ok) {
      console.error(`updateSeries: Response not ok for id ${seriesId}, status:`, response.status);
      throw new Error('Failed to update series');
    }

    const data = await response.json();
    return data;
  } catch (error) {
    console.error(`updateSeries: Error updating series ${seriesId}:`, error);
    throw error;
  }
};

export const deleteSeries = async (seriesId: string): Promise<void> => {
  try {
    const response = await fetch(`${API_BASE}/api/series/${seriesId}`, {
      method: 'DELETE',
    });

    if (!response.ok) {
      console.error(`deleteSeries: Response not ok for id ${seriesId}, status:`, response.status);
      throw new Error('Failed to delete series');
    }
  } catch (error) {
    console.error(`deleteSeries: Error deleting series ${seriesId}:`, error);
    throw error;
  }
};

export const addSermonToSeries = async (seriesId: string, sermonId: string, position?: number): Promise<void> => {
  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    const response = await fetch(`${API_BASE}/api/series/${seriesId}/sermons`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ sermonId, position }),
    });

    if (!response.ok) {
      console.error(`addSermonToSeries: Response not ok for series ${seriesId}, sermon ${sermonId}, status:`, response.status);
      throw new Error('Failed to add sermon to series');
    }
  } catch (error) {
    console.error(`addSermonToSeries: Error adding sermon ${sermonId} to series ${seriesId}:`, error);
    throw error;
  }
};

export const removeSermonFromSeries = async (seriesId: string, sermonId: string): Promise<void> => {
  try {
    const response = await fetch(`${API_BASE}/api/series/${seriesId}/sermons?sermonId=${sermonId}`, {
      method: 'DELETE',
    });

    if (!response.ok) {
      console.error(`removeSermonFromSeries: Response not ok for series ${seriesId}, sermon ${sermonId}, status:`, response.status);
      throw new Error('Failed to remove sermon from series');
    }
  } catch (error) {
    console.error(`removeSermonFromSeries: Error removing sermon ${sermonId} from series ${seriesId}:`, error);
    throw error;
  }
};

export const reorderSermons = async (seriesId: string, sermonIds: string[]): Promise<void> => {
  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    const response = await fetch(`${API_BASE}/api/series/${seriesId}/sermons`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({ sermonIds }),
    });

    if (!response.ok) {
      console.error(`reorderSermons: Response not ok for series ${seriesId}, status:`, response.status);
      throw new Error('Failed to reorder sermons');
    }
  } catch (error) {
    console.error(`reorderSermons: Error reordering sermons in series ${seriesId}:`, error);
    throw error;
  }
};
