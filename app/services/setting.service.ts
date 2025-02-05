import { log } from '@utils/logger';
const API_BASE = process.env.NEXT_PUBLIC_API_BASE || 'http://localhost:3000';

export async function getTags() {
  log.info('getTags: Fetching tags from server');
  try {
    const res = await fetch(`${API_BASE}/api/tags`, { cache: 'no-store' });
    if (!res.ok) {
      throw new Error('Failed to fetch tags');
    }
    const data = await res.json();
    log.info('getTags: Tags fetched successfully', data);
    return data;
  } catch (error) {
    log.error('getTags: Error fetching tags', error);
    throw error;
  }
}

export async function addCustomTag(tag: { id: string; name: string; color: string }) {
  log.info('addCustomTag: Adding custom tag', tag);
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
    log.info('addCustomTag: Custom tag added successfully');
    return tag;
  } catch (error) {
    log.error('addCustomTag: Error adding custom tag', error);
    throw error;
  }
}