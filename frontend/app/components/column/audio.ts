
import { toast } from "sonner";

import { isPointAudioSection } from "./utils";

import type { OnAudioThoughtCreated, Translate } from "./types";
import type React from "react";

interface RecordAudioThoughtArgs {
  audioBlob: Blob;
  sectionId: string;
  sermonId: string;
  setIsRecordingAudio: React.Dispatch<React.SetStateAction<boolean>>;
  setAudioError: (error: string | null) => void;
  onAudioThoughtCreated?: OnAudioThoughtCreated;
  t: Translate;
  pointId?: string;
  subPointId?: string;
  successMessage?: string;
  onSuccess?: () => void;
  errorContext: string;
}

export const recordAudioThought = async ({
  audioBlob,
  sectionId,
  sermonId,
  setIsRecordingAudio,
  setAudioError,
  onAudioThoughtCreated,
  t,
  pointId,
  subPointId,
  successMessage,
  onSuccess,
  errorContext,
}: RecordAudioThoughtArgs) => {
  try {
    setIsRecordingAudio(true);
    setAudioError(null);

    const { createAudioThought } = await import("@/services/thought.service");
    const newThought = pointId
      ? subPointId
        ? await createAudioThought(audioBlob, sermonId, 0, 3, pointId, subPointId)
        : await createAudioThought(audioBlob, sermonId, 0, 3, pointId)
      : await createAudioThought(audioBlob, sermonId);

    if (isPointAudioSection(sectionId)) {
      onAudioThoughtCreated?.(newThought, sectionId);
    }

    onSuccess?.();
    toast.success(
      successMessage ?? t("manualThought.addedSuccess", { defaultValue: "Thought added successfully" })
    );
    return newThought;
  } catch (error) {
    console.warn(errorContext, error);
    const errorMessage = error instanceof Error ? error.message : t("errors.audioProcessing");
    setAudioError(String(errorMessage));
    toast.error(String(errorMessage));
    return null;
  } finally {
    setIsRecordingAudio(false);
  }
};
