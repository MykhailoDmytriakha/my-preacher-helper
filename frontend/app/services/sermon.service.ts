import { Sermon } from '@/models/models';
const API_BASE = process.env.NEXT_PUBLIC_API_BASE;

export const getSermons = async (userId: string): Promise<Sermon[]> => {
  try {
    const response = await fetch(`${API_BASE}/api/sermons?userId=${userId}`, {
      cache: "no-store"
    });
    if (!response.ok) {
      console.error(`getSermons: Response not ok, status: ${response.status}`);
      throw new Error('Failed to fetch sermons');
    }
    const data = await response.json();
    return data.sort((a: Sermon, b: Sermon) => new Date(b.date).getTime() - new Date(a.date).getTime());
  } catch (error) {
    console.error('getSermons: Error fetching sermons:', error);
    return [];
  }
};

export const getSermonById = async (id: string): Promise<Sermon | undefined> => {
  try {
    const response = await fetch(`${API_BASE}/api/sermons/${id}`);
    if (!response.ok) {
      console.error(`getSermonById: Response not ok for id ${id}, status: ${response.status}`);
      throw new Error('Failed to fetch sermon');
    }
    const data = await response.json();
    return data;
  } catch (error) {
    console.error(`getSermonById: Error fetching sermon ${id}:`, error);
    return undefined;
  }
};

export const createSermon = async (sermon: Omit<Sermon, 'id'>): Promise<Sermon> => {
  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    const response = await fetch(`${API_BASE}/api/sermons`, {
      method: 'POST',
      headers,
      body: JSON.stringify(sermon),
    });
    if (!response.ok) {
      console.error("createSermon: Response not ok, status:", response.status);
      throw new Error('Failed to create sermon');
    }
    const data = await response.json();
    return data.sermon;
  } catch (error) {
    console.error('createSermon: Error creating sermon:', error);
    throw error;
  }
};

export async function deleteSermon(sermonId: string): Promise<void> {
  const response = await fetch(`${API_BASE}/api/sermons/${sermonId}`, {
    method: 'DELETE'
  });
  if (!response.ok) {
    throw new Error(`Failed to delete sermon with id ${sermonId}`);
  }
}

export const updateSermon = async (updatedSermon: Sermon): Promise<Sermon | null> => {
  try {
    const response = await fetch(`${API_BASE}/api/sermons/${updatedSermon.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(updatedSermon),
    });
    if (!response.ok) {
      console.error(`updateSermon: Response not ok for id ${updatedSermon.id}, status: ${response.status}`);
      return null;
    }
    const data = await response.json();
    return data;
  } catch (error) {
    console.error('updateSermon: Error updating sermon', error);
    return null;
  }
};
