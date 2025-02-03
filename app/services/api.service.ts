export interface Thought {
    // Теперь используем массив тегов вместо одного тега
    text: string;
    tags: string[];
    date: string;
  }
  
  export interface Sermon {
    id: string;
    title: string;
    verse: string;
    date: string;
    thoughts: Thought[];
    structure?: string;
  }
  
  const API_BASE = process.env.NEXT_PUBLIC_API_BASE || 'http://localhost:3000';
  
  export const getSermons = async (): Promise<Sermon[]> => {
    console.log(`getSermons: Initiating fetch from ${API_BASE}/api/sermons`);
    try {
      const response = await fetch(`${API_BASE}/api/sermons`, {
        cache: "no-store"
      });
      console.log("getSermons: Received response", response);
      if (!response.ok) {
        console.error(`getSermons: Response not ok, status: ${response.status}`);
        throw new Error('Failed to fetch sermons');
      }
      const data = await response.json();
      console.log("getSermons: Sermons fetched successfully", data);
      // Сортируем проповеди по дате (сначала последние)
      return data.sort((a: Sermon, b: Sermon) => new Date(b.date).getTime() - new Date(a.date).getTime());
    } catch (error) {
      console.error('getSermons: Error fetching sermons:', error);
      return [];
    }
  };
  
  export const getSermonById = async (id: string): Promise<Sermon | undefined> => {
    console.log(`getSermonById: Initiating fetch for sermon with id ${id}`);
    try {
      const response = await fetch(`${API_BASE}/api/sermons/${id}`);
      console.log(`getSermonById: Received response for id ${id}`, response);
      if (!response.ok) {
        console.error(`getSermonById: Response not ok for id ${id}, status: ${response.status}`);
        throw new Error('Failed to fetch sermon');
      }
      const data = await response.json();
      console.log("getSermonById: Sermon fetched successfully", data);
      return data;
    } catch (error) {
      console.error(`getSermonById: Error fetching sermon ${id}:`, error);
      return undefined;
    }
  };
  
  export const createSermon = async (sermon: Omit<Sermon, 'id'>): Promise<Sermon> => {
    console.log("createSermon: Initiating creation of sermon", sermon);
    try {
      const response = await fetch(`${API_BASE}/api/sermons`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(sermon),
      });
      console.log("createSermon: Received response", response);
      if (!response.ok) {
        console.error("createSermon: Response not ok, status:", response.status);
        throw new Error('Failed to create sermon');
      }
      const data = await response.json();
      console.log("createSermon: Sermon created successfully", data);
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
    console.log("transcribeAudio: Starting transcription process.");
  
    const formData = new FormData();
    formData.append("audio", audioBlob, "recording.webm");
    formData.append("sermonId", sermonId);
  
    console.log(
      `transcribeAudio: Sending audio blob and sermon id ${sermonId} to ${API_BASE}/api/thoughts.`
    );
  
    const response = await fetch(`${API_BASE}/api/thoughts`, {
      method: "POST",
      body: formData,
    });
  
    console.log("transcribeAudio: Received response:", response);
    if (!response.ok) {
      console.error("transcribeAudio: Transcription failed with status", response.status);
      throw new Error("Transcription failed");
    }
  
    // Возвращаем полный объект с текстом, тегами и т.д.
    const thought = await response.json();
    console.log("transcribeAudio: Transcription succeeded. Thought:", thought);
    return thought;
  };
  