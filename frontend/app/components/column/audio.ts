
import { toast } from "sonner";

import { isUsageCapReachedError } from "@/services/usageLimits";

import { isPointAudioSection } from "./utils";

import type { OnAudioThoughtCreated, Translate } from "./types";
import type React from "react";

interface RecordAudioThoughtArgs {
  audioBlob: Blob;
  sectionId: string;
  sermonId: string;
  setIsRecordingAudio: React.Dispatch<React.SetStateAction<boolean>>;
  setAudioError: (error: string | null) => void;
  /** Told apart from a failure: the month's allowance is spent, so retrying cannot help. */
  setLimitReached?: (limitReached: boolean) => void;
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
  setLimitReached,
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
    setLimitReached?.(false);

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

    /**
     * BEING REFUSED IS NOT A FAILURE, AND IT ALREADY HAS A VOICE.
     *
     * Both halves of what the preacher saw came from these three lines. `error.message` of a
     * usage-cap error is `Usage cap reached for ai` — a sentence written for a developer —
     * and it was put on the card AND raised as a red toast, on top of the warm message the
     * global handler had just raised for the same event. One event, three announcements, two
     * of them in English.
     */
    if (isUsageCapReachedError(error)) {
      setLimitReached?.(true);
      setAudioError(t("audio.limitReached"));
      return null;
    }

    const errorMessage = error instanceof Error ? error.message : t("errors.audioProcessing");
    setAudioError(String(errorMessage));
    toast.error(String(errorMessage));
    return null;
  } finally {
    setIsRecordingAudio(false);
  }
};
