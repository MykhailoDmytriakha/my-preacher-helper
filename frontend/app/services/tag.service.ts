import { log } from '@utils/logger';
import { Tag } from '@/models/models';
const API_BASE = process.env.NEXT_PUBLIC_API_BASE || 'http://localhost:3000';

export async function getTags(userId: string) {
  try {
    const res = await fetch(`${API_BASE}/api/tags?userId=${userId}`, { cache: 'no-store' });
    if (!res.ok) {
      throw new Error('Failed to fetch tags');
    }
    const data = await res.json();
    console.log("data", data);
    return data;
  } catch (error) {
    log.error('getTags: Error fetching tags', error);
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
      throw new Error('Failed to add custom tag');
    }
    return tag;
  } catch (error) {
    log.error('addCustomTag: Error adding custom tag', error);
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
    return tagName;
  } catch (error) {
    log.error('removeCustomTag: Error removing custom tag', error);
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
    log.error('updateTag: Error updating tag', error);
    throw error;
  }
}