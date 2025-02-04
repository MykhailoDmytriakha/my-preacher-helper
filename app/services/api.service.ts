import { Sermon, Thought } from '@/models/models';
import { log } from '@utils/logger';
const API_BASE = process.env.NEXT_PUBLIC_API_BASE || 'http://localhost:3000';

export const getSermons = async (): Promise<Sermon[]> => {
  log.info(`getSermons: Initiating fetch from ${API_BASE}/api/sermons`);
  try {
    const response = await fetch(`${API_BASE}/api/sermons`, {
      cache: "no-store"
    });
    log.info("getSermons: Received response", response);
    if (!response.ok) {
      console.error(`getSermons: Response not ok, status: ${response.status}`);
      throw new Error('Failed to fetch sermons');
    }
    const data = await response.json();
    log.info("getSermons: Sermons fetched successfully", data);
    // Сортируем проповеди по дате (сначала последние)
    return data.sort((a: Sermon, b: Sermon) => new Date(b.date).getTime() - new Date(a.date).getTime());
  } catch (error) {
    console.error('getSermons: Error fetching sermons:', error);
    return [];
  }
};

export const getSermonById = async (id: string): Promise<Sermon | undefined> => {
  log.info(`getSermonById: Initiating fetch for sermon with id ${id}`);
  try {
    log.info(`api.service.ts: getSermonById called for id ${id}`);
    const response = await fetch(`${API_BASE}/api/sermons/${id}`);
    log.info(`api.service.ts: Received response for id ${id} with status ${response.status}`);
    if (!response.ok) {
      console.error(`getSermonById: Response not ok for id ${id}, status: ${response.status}`);
      throw new Error('Failed to fetch sermon');
    }
    const data = await response.json();
    log.info(`api.service.ts: Parsed sermon for id ${id}`, data);
    return data;
  } catch (error) {
    console.error(`getSermonById: Error fetching sermon ${id}:`, error);
    return undefined;
  }
};

export const createSermon = async (sermon: Omit<Sermon, 'id'>): Promise<Sermon> => {
  log.info("createSermon: Initiating creation of sermon", sermon);
  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    const response = await fetch(`${API_BASE}/api/sermons`, {
      method: 'POST',
      headers,
      body: JSON.stringify(sermon),
    });
    log.info("createSermon: Received response", response);
    if (!response.ok) {
      console.error("createSermon: Response not ok, status:", response.status);
      throw new Error('Failed to create sermon');
    }
    const data = await response.json();
    log.info("createSermon: Sermon created successfully", data);
    return data.sermon;
  } catch (error) {
    console.error('createSermon: Error creating sermon:', error);
    throw error;
  }
};

// Изменяем функцию для обработки аудио, чтобы возвращался полный объект Thought
export const transcribeAudioToNote = async (
  audioBlob: Blob,
  sermonId: string
): Promise<Thought> => {
  // TODO: i want to know what is the length of this audio, and leter to track this data
  log.info("transcribeAudio: Starting transcription process.");

  const formData = new FormData();
  formData.append("audio", audioBlob, "recording.webm");
  formData.append("sermonId", sermonId);

  log.info(
    `transcribeAudio: Sending audio blob and sermon id ${sermonId} to ${API_BASE}/api/thoughts.`
  );

  const response = await fetch(`${API_BASE}/api/thoughts`, {
    method: "POST",
    body: formData,
  });

  log.info("transcribeAudio: Received response:", response);
  if (!response.ok) {
    console.error("transcribeAudio: Transcription failed with status", response.status);
    throw new Error("Transcription failed");
  }

  // Возвращаем полный объект с текстом, тегами и т.д.
  const thought = await response.json();
  log.info("transcribeAudio: Transcription succeeded. Thought:", thought);
  return thought;
};

// Added deleteSermon function export
export async function deleteSermon(sermonId: string): Promise<void> {
  const response = await fetch(`/api/sermons/${sermonId}`, {
    method: 'DELETE'
  });
  if (!response.ok) {
    throw new Error(`Failed to delete sermon with id ${sermonId}`);
  }
}

// Added deleteThought function export
export const deleteThought = async (sermonId: string, thought: Thought): Promise<void> => {
  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    const response = await fetch(`${API_BASE}/api/thoughts`, {
      method: "DELETE",
      headers,
      body: JSON.stringify({ sermonId, thought }),
    });
    if (!response.ok) {
      throw new Error(`Failed to delete thought with status ${response.status}`);
    }
  } catch (error) {
    console.error('deleteThought: Error deleting thought:', error);
    throw error;
  }
};
  