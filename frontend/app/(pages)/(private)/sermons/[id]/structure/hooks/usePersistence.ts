import debounce from 'lodash/debounce';
import { useCallback, useEffect, useMemo, useRef } from "react";
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { Thought, ThoughtsBySection, Sermon } from "@/models/models";
import { updateStructure } from "@/services/structure.service";
import { updateThought } from "@/services/thought.service";


interface UsePersistenceProps {
  setSermon: React.Dispatch<React.SetStateAction<Sermon | null>>;
}

export const usePersistence = ({ setSermon }: UsePersistenceProps) => {
  const { t } = useTranslation();
  const debouncedThoughtsRef = useRef<Map<string, ReturnType<typeof debounce>>>(new Map());

  // Save functions for structure and thoughts
  const saveStructure = useCallback(
    async (sermonId: string, structure: ThoughtsBySection) => {
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
  const debouncedSaveThought = useCallback(
    (sermonId: string, thought: Thought) => {
      const key = `${sermonId}:${thought.id}`;
      let debounced = debouncedThoughtsRef.current.get(key);
      if (!debounced) {
        debounced = debounce(saveThought, 500);
        debouncedThoughtsRef.current.set(key, debounced);
      }
      debounced(sermonId, thought);
    },
    [saveThought]
  );

  // Prevent stray saves after unmount or navigation
  // Cancel debounced functions on unmount to avoid writing to stale sermons
  useEffect(() => {
    const debouncedThoughts = debouncedThoughtsRef.current;
    return () => {
      try { debouncedSaveStructure.flush(); } catch {}
      debouncedThoughts.forEach((debounced) => {
        try { debounced.flush(); } catch {}
      });
      debouncedThoughts.clear();
    };
  }, [debouncedSaveStructure]);

  return {
    saveStructure,
    saveThought,
    debouncedSaveStructure,
    debouncedSaveThought,
  };
};
