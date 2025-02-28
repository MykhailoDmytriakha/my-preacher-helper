import { Thought } from "@/models/models";
import { toast } from 'sonner';
const API_BASE = process.env.NEXT_PUBLIC_API_BASE;

export const createAudioThought = async (
  audioBlob: Blob,
  sermonId: string
): Promise<Thought> => {
  try {
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
      console.error(
        "transcribeAudio: Transcription failed with status",
        response.status
      );
      throw new Error("Transcription failed");
    }

    // Возвращаем полный объект с текстом, тегами и т.д.
    const thought = await response.json();
    console.log("transcribeAudio: Transcription succeeded. Thought:", thought);
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
    
    const requestBody = JSON.stringify({ sermonId, thought });
    const response = await fetch(`${API_BASE}/api/thoughts`, {
      method: "PUT",
      headers,
      body: requestBody,
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error("thought.service: Server error response:", errorText);
      throw new Error(
        `Failed to update thought with status ${response.status}: ${errorText}`
      );
    }
    
    const updatedThought = await response.json();
    return updatedThought;
  } catch (error) {
    console.error("updateThought: Error updating thought", error);
    throw error;
  }
};

export const createManualThought = async (
  sermonId: string,
  thought: Thought
): Promise<Thought> => {
  try {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    const response = await fetch(`${API_BASE}/api/thoughts?manual=true`, {
      method: "POST",
      headers,
      body: JSON.stringify({ sermonId, thought }),
    });
    if (!response.ok) {
      throw new Error(`Failed to create manual thought with status ${response.status}`);
    }
    const savedThought = await response.json();
    return savedThought;
  } catch (error) {
    console.error("createManualThought: Error creating thought manually", error);
    throw error;
  }
};