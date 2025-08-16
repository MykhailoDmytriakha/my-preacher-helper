import { Thought } from "@/models/models";
import { toast } from 'sonner';
const API_BASE = process.env.NEXT_PUBLIC_API_BASE;

export const createAudioThought = async (
  audioBlob: Blob,
  sermonId: string,
  retryCount: number = 0,
  maxRetries: number = 3
): Promise<Thought> => {
  return createAudioThoughtWithForceTag(audioBlob, sermonId, null, retryCount, maxRetries);
};

// New function for creating audio thought with force tag
export const createAudioThoughtWithForceTag = async (
  audioBlob: Blob,
  sermonId: string,
  forceTag: string | null = null,
  retryCount: number = 0,
  maxRetries: number = 3
): Promise<Thought> => {
  // If we've exceeded max retries, throw immediately
  if (retryCount >= maxRetries) {
    throw new Error(`Transcription failed after all retries: Maximum retry attempts exceeded`);
  }

  try {
    console.log(`transcribeAudio: Starting transcription process. Attempt ${retryCount + 1}/${maxRetries + 1}`);
    if (forceTag) {
      console.log(`transcribeAudio: Force tag "${forceTag}" will be applied`);
    }

    const formData = new FormData();
    formData.append("audio", audioBlob, "recording.webm");
    formData.append("sermonId", sermonId);
    if (forceTag) {
      formData.append("forceTag", forceTag);
    }

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
      
      let errorText = `HTTP ${response.status}`;
      let originalText = null;
      try {
        const errorResponse = await response.json();
        errorText = errorResponse.error || errorText;
        originalText = errorResponse.originalText || null;
      } catch {
        // If we can't parse JSON, use the status text
        errorText = response.statusText || errorText;
      }
      console.error("transcribeAudio: Error response:", errorText);
      
      // If we have retries left, throw an error to trigger retry
      if (retryCount < maxRetries) {
        // If we have originalText, include it in the error message
        if (originalText) {
          throw new Error(`Transcription failed (attempt ${retryCount + 1}/${maxRetries + 1}): ${errorText}. Recognized text: "${originalText}"`);
        } else {
          throw new Error(`Transcription failed (attempt ${retryCount + 1}/${maxRetries + 1}): ${errorText}`);
        }
      }
      
      // If no retries left, show error and throw
      if (originalText) {
        toast.error(`Ошибка обработки аудио после всех попыток: ${errorText}. Распознанный текст: "${originalText}"`);
        throw new Error(`Transcription failed after all retries: ${errorText}. Recognized text: "${originalText}"`);
      } else {
        toast.error(`Ошибка обработки аудио после всех попыток: ${errorText}`);
        throw new Error(`Transcription failed after all retries: ${errorText}`);
      }
    }

    // Success - clear stored audio if available
    if (typeof window !== 'undefined' && (window as any).clearAudioRecorderStorage) {
      (window as any).clearAudioRecorderStorage();
    }

    // Возвращаем полный объект с текстом, тегами и т.д.
    const thought = await response.json();
    console.log("transcribeAudio: Transcription succeeded. Thought:", thought);
    
    // Show success message
    toast.success("Аудио успешно обработано!");
    
    return thought;
  } catch (error) {
    console.error("createAudioThought: Error creating thought", error);
    
    // If we have retries left, don't show error toast yet
    if (retryCount < maxRetries) {
      console.log(`createAudioThought: Will retry. Attempt ${retryCount + 1}/${maxRetries + 1}`);
      throw error; // Re-throw to trigger retry
    }
    
    // Show error toast only on final failure
    toast.error("Ошибка обработки аудио. Попробуйте ещё раз.");
    throw error;
  }
};

// New function for retrying transcription
export const retryAudioTranscription = async (
  audioBlob: Blob,
  sermonId: string,
  retryCount: number,
  maxRetries: number = 3,
  forceTag: string | null = null
): Promise<Thought> => {
  return createAudioThoughtWithForceTag(audioBlob, sermonId, forceTag, retryCount, maxRetries);
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