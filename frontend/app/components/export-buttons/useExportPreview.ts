import { useEffect, useState } from 'react';

/** A prepared view belongs to its current opening and builder, never an older request. */
export function useExportPreview<T>(isOpen: boolean, load: () => Promise<T>) {
  const [preview, setPreview] = useState<{ content: T | null; isLoading: boolean; error: boolean }>({
    content: null, isLoading: true, error: false,
  });
  useEffect(() => {
    if (!isOpen) return;
    let active = true;
    setPreview({ content: null, isLoading: true, error: false });
    void Promise.resolve().then(load).then(content => {
      if (active) setPreview({ content, isLoading: false, error: false });
    }).catch(cause => {
      if (!active) return;
      console.error('Error preparing export content:', cause);
      setPreview({ content: null, isLoading: false, error: true });
    });
    return () => { active = false; };
  }, [isOpen, load]);
  return preview;
}
