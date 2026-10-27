import React, { useEffect, useRef, useState } from 'react';

import type { PreparationTextBinding } from '@/components/common/manualTextBinding';
import type { Json } from '@/data-engine/types';
import { preparationWords, trimmedPreparationText } from '@/utils/preparationFieldValues';

export type PreparationPresentationCodec = {
  read(value: Json | undefined): string;
  save(value: string): Json;
};

const textCodec: PreparationPresentationCodec = {
  read: value => typeof value === 'string' ? value : '',
  save: value => value,
};

export const trimmedTextCodec: PreparationPresentationCodec = {
  read: value => typeof value === 'string' ? value : '',
  save: value => trimmedPreparationText.save(value),
};

export const repeatedWordsCodec: PreparationPresentationCodec = {
  read: value => preparationWords.read(value),
  save: value => preparationWords.save(value),
};

/** Presentation-only controlled binding. Engine persistence and ancestry are covered elsewhere. */
export function PreparationBindingFixture({
  value,
  subject = 'preparation-fixture',
  codec = textCodec,
  onSave,
  valid,
  children,
}: {
  value: string;
  subject?: string;
  codec?: PreparationPresentationCodec;
  onSave?: (value: Json) => void;
  valid?: (value: string) => boolean;
  children(binding: PreparationTextBinding): React.ReactNode;
}) {
  const [stored, setStored] = useState(value);
  const [stage, setStage] = useState(value);
  const [busy, setBusy] = useState(false);
  const previousExternal = useRef(value);

  useEffect(() => {
    if (previousExternal.current === value) return;
    previousExternal.current = value;
    if (stage === stored) {
      setStored(value);
      setStage(value);
    }
  }, [value, stage, stored]);

  const binding: PreparationTextBinding = {
    subject,
    value: stage,
    ready: true,
    active: true,
    busy,
    dirty: stage !== stored,
    canSave: !valid || valid(stage),
    error: null,
    begin: async () => undefined,
    update: async next => { setStage(next); },
    save: async next => {
      setBusy(true);
      try {
        const persisted = codec.save(next);
        const visible = codec.read(persisted);
        onSave?.(persisted);
        setStored(visible);
        setStage(visible);
      } finally {
        setBusy(false);
      }
    },
    cancel: async () => { setStage(stored); },
    retry: async () => undefined,
    recovery: {
      choices: [], loading: false, error: null,
      recover: async () => undefined, refresh: async () => undefined,
    },
  };

  return <>{children(binding)}</>;
}
