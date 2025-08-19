import { useCallback, useMemo } from "react";
import { updateStructure } from "@/services/structure.service";
import { updateThought } from "@/services/thought.service";
import { Thought, Structure, Sermon } from "@/models/models";
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import debounce from 'lodash/debounce';

interface UsePersistenceProps {
  setSermon: React.Dispatch<React.SetStateAction<Sermon | null>>;
}

export const usePersistence = ({ setSermon }: UsePersistenceProps) => {
  const { t } = useTranslation();

  // Save functions for structure and thoughts
  const saveStructure = useCallback(
    async (sermonId: string, structure: Structure) => {
      try {
        await updateStructure(sermonId, structure);
      } catch {
        toast.error(t('errors.failedToSaveStructure'));
      }
    },
    [t]
  );

  const saveThought = useCallback(
    async (sermonId: string, thought: Thought) => {
      try {
        const updatedThought = await updateThought(sermonId, thought);
        setSermon((prev: Sermon | null) => {
          if (!prev) return prev;
          return {
            ...prev,
            thoughts: prev.thoughts.map((t: Thought) => (t.id === updatedThought.id ? updatedThought : t)),
          };
        });
      } catch {
        toast.error(t('errors.failedToSaveThought'));
      }
    },
    [setSermon, t]
  );

  // Create debounced versions
  const debouncedSaveStructure = useMemo(() => debounce(saveStructure, 500), [saveStructure]);
  const debouncedSaveThought = useMemo(() => debounce(saveThought, 500), [saveThought]);

  return {
    saveStructure,
    saveThought,
    debouncedSaveStructure,
    debouncedSaveThought,
  };
};
