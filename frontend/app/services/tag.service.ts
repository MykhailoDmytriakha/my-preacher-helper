import { Tag } from '@/models/models';
import { log } from 'console';
const API_BASE = process.env.NEXT_PUBLIC_API_BASE;

export async function getTags(userId: string) {
  try {
    const res = await fetch(`${API_BASE}/api/tags?userId=${userId}`, { cache: 'no-store' });
    if (!res.ok) {
      throw new Error('Failed to fetch tags');
    }
    const data = await res.json();
    return data;
  } catch (error) {
    console.error('getTags: Error fetching tags', error);
    throw error;
  }
}

export async function addCustomTag(tag: Tag) {
  try {
    const res = await fetch(`${API_BASE}/api/tags`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(tag)
    });
    if (!res.ok) {
      try {
        const data = await res.json();
        throw new Error(data?.message || 'Failed to add custom tag');
      } catch {
        throw new Error('Failed to add custom tag');
      }
    }
    return tag;
  } catch (error) {
    console.error('addCustomTag: Error adding custom tag', error);
    throw error;
  }
}

export async function removeCustomTag(userId: string, tagName: string) {
  try {
    const res = await fetch(`${API_BASE}/api/tags?userId=${userId}&tagName=${encodeURIComponent(tagName)}`, {
      method: 'DELETE',
    });
    if (!res.ok) {
      throw new Error('Failed to remove custom tag');
    }
    const data = await res.json();
    return data;
  } catch (error) {
    console.error('removeCustomTag: Error removing custom tag', error);
    throw error;
  }
}

export async function updateTag(tag: Tag) {
  try {
    const res = await fetch(`${API_BASE}/api/tags`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(tag)
    });
    if (!res.ok) {
      throw new Error('Failed to update tag');
    }
    const data = await res.json();
    return data;
  } catch (error) {
    console.error('updateTag: Error updating tag', error);
    throw error;
  }
}