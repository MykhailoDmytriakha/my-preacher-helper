import { Thought } from "@/models/models";
import { log } from "@utils/logger";
import { toast } from 'sonner';
const API_BASE = process.env.NEXT_PUBLIC_API_BASE || "http://localhost:3000";

export const createAudioThought = async (
  audioBlob: Blob,
  sermonId: string
): Promise<Thought> => {
  try {
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
      console.error(
        "transcribeAudio: Transcription failed with status",
        response.status
      );
      throw new Error("Transcription failed");
    }

    // Возвращаем полный объект с текстом, тегами и т.д.
    const thought = await response.json();
    log.info("transcribeAudio: Transcription succeeded. Thought:", thought);
    return thought;
  } catch (error) {
    console.error("createAudioThought: Error creating thought", error);
    // Добавляем вызов системы уведомлений
    toast.error("Ошибка обработки аудио. Попробуйте ещё раз.");
    throw error;
  }
};

export const deleteThought = async (
  sermonId: string,
  thought: Thought
): Promise<void> => {
  try {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    const response = await fetch(`${API_BASE}/api/thoughts`, {
      method: "DELETE",
      headers,
      body: JSON.stringify({ sermonId, thought }),
    });
    if (!response.ok) {
      throw new Error(
        `Failed to delete thought with status ${response.status}`
      );
    }
  } catch (error) {
    console.error("deleteThought: Error deleting thought:", error);
    throw error;
  }
};

export const updateThought = async (
  sermonId: string,
  thought: Thought
): Promise<Thought> => {
  try {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    const response = await fetch(`${API_BASE}/api/thoughts`, {
      method: "PUT",
      headers,
      body: JSON.stringify({ sermonId, thought }),
    });
    if (!response.ok) {
      throw new Error(
        `Failed to update thought with status ${response.status}`
      );
    }
    const updatedThought = await response.json();
    return updatedThought;
  } catch (error) {
    console.error("updateThought: Error updating thought", error);
    throw error;
  }
};

export const generateTags = async (): Promise<any> => {
  try {
    const response = await fetch(`${API_BASE}/api/tags`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        command: "generate",
      }),
    });
    if (!response.ok) {
      throw new Error(`Failed to fetch tags with status ${response.status}`);
    }
    return await response.json();
  } catch (error) {
    console.error("generateTags: Error fetching tags", error);
    throw error;
  }
};
