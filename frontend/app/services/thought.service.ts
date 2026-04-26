import { toast } from 'sonner';

import { Thought } from "@/models/models";
import { apiClient } from '@/utils/apiClient';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE;
const AUDIO_RETRY_DELAY_MS = process.env.NODE_ENV === 'test' ? 0 : 1200;

type AudioThoughtErrorResponse = {
  error?: string;
  originalText?: string;
  retryable?: boolean;
  phase?: string;
};

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function buildTranscriptionFailureMessage(params: {
  errorText: string;
  originalText?: string | null;
  retryCount: number;
  maxRetries: number;
}) {
  const { errorText, originalText, retryCount, maxRetries } = params;
  const baseMessage = `Transcription failed (attempt ${retryCount + 1}/${maxRetries + 1}): ${errorText}`;

  return originalText
    ? `${baseMessage}. Recognized text: "${originalText}"`
    : baseMessage;
}

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
  maxRetries: number = 3,
  outlinePointId?: string
): Promise<Thought> => {
  // maxRetries means retries after the first attempt, so attempt indexes are 0..maxRetries.
  if (retryCount > maxRetries) {
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
    if (outlinePointId) {
      formData.append("outlinePointId", outlinePointId);
    }

    console.log(
      `transcribeAudio: Sending audio blob and sermon id ${sermonId} to ${API_BASE}/api/thoughts.`
    );

    const response = await apiClient(`${API_BASE}/api/thoughts`, {
      method: "POST",
      body: formData,
      category: 'audio'
    });

    console.log("transcribeAudio: Received response:", response);
    
    if (!response.ok) {
      console.warn(
        "transcribeAudio: Transcription failed with status",
        response.status
      );
      
      let errorText = `HTTP ${response.status}`;
      let originalText = null;
      let retryable = false;
      let phase: string | undefined;
      try {
        const errorResponse = await response.json() as AudioThoughtErrorResponse;
        errorText = errorResponse.error || errorText;
        originalText = errorResponse.originalText || null;
        retryable = Boolean(errorResponse.retryable);
        phase = errorResponse.phase;
      } catch {
        // If we can't parse JSON, use the status text
        errorText = response.statusText || errorText;
      }
      console.warn("transcribeAudio: Error response:", errorText);
      
      if (retryable && phase === 'transcribe_audio' && retryCount < maxRetries) {
        console.warn(
          `transcribeAudio: Retrying retryable transcription failure. Next attempt ${retryCount + 2}/${maxRetries + 1}`
        );
        await wait(AUDIO_RETRY_DELAY_MS * (retryCount + 1));
        return createAudioThoughtWithForceTag(
          audioBlob,
          sermonId,
          forceTag,
          retryCount + 1,
          maxRetries,
          outlinePointId
        );
      }
      
      const exhaustedRetryableFailure = retryable && retryCount >= maxRetries;
      const failureMessage = exhaustedRetryableFailure
        ? `Transcription failed after all retries: ${errorText}${originalText ? `. Recognized text: "${originalText}"` : ''}`
        : buildTranscriptionFailureMessage({ errorText, originalText, retryCount, maxRetries });

      throw new Error(failureMessage);
    }

    // Success - clear stored audio if available
    if (typeof window !== 'undefined') {
      const maybeWindow = window as Window & { clearAudioRecorderStorage?: () => void };
      maybeWindow.clearAudioRecorderStorage?.();
    }

    // Возвращаем полный объект с текстом, тегами и т.д.
    const thought = await response.json();
    console.log("transcribeAudio: Transcription succeeded. Thought:", thought);
    
    // Show success message
    toast.success("Аудио успешно обработано!");
    
    return thought;
  } catch (error) {
    console.warn("createAudioThought: Error creating thought", error);
    
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

type ThoughtTranscriptionResult = {
  polishedText: string;
  originalText: string;
  warning?: string;
};

export const transcribeThoughtAudio = async (audioBlob: Blob): Promise<ThoughtTranscriptionResult> => {
  try {
    const formData = new FormData();
    formData.append("audio", audioBlob, "recording.webm");

    const response = await apiClient(`${API_BASE}/api/thoughts/transcribe`, {
      method: "POST",
      body: formData,
      category: 'audio'
    });

    let data: { success?: boolean; polishedText?: string; originalText?: string; warning?: string; error?: string } | null = null;
    try {
      data = await response.json();
    } catch {
      data = null;
    }

    if (!response.ok || !data?.success) {
      const errorMessage = data?.error || response.statusText || `HTTP ${response.status}`;
      throw new Error(errorMessage);
    }

    return {
      polishedText: data.polishedText ?? data.originalText ?? '',
      originalText: data.originalText ?? data.polishedText ?? '',
      warning: data.warning,
    };
  } catch (error) {
    console.error("transcribeThoughtAudio: Error transcribing audio", error);
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
    const response = await apiClient(`${API_BASE}/api/thoughts`, {
      method: "DELETE",
      headers,
      body: JSON.stringify({ sermonId, thought }),
      category: 'crud'
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
    const response = await apiClient(`${API_BASE}/api/thoughts`, {
      method: "PUT",
      headers,
      body: requestBody,
      category: 'crud'
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
    const response = await apiClient(`${API_BASE}/api/thoughts?manual=true`, {
      method: "POST",
      headers,
      body: JSON.stringify({ sermonId, thought }),
      category: 'crud'
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
