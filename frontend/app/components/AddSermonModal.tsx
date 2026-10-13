"use client";

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { EngineCreateSermonModal } from '@/components/sermon/EngineCreateSermonModal';
import { PlusIcon } from "@components/Icons";

interface AddSermonModalProps {
  onCancel?: () => void;
  preSelectedSeriesId?: string;
  isOpen?: boolean;
  onClose?: () => void;
  showTriggerButton?: boolean;
  allowPlannedDate?: boolean;
  /** Called with the new sermon's id once the engine holds it on this device. */
  onCreated?: (sermonId: string) => void;
  /** Raised while this modal is on screen, for whoever renders what it covers. */
  onOpenChange?: (isOpen: boolean) => void;
}

const NEW_SERMON_KEY = 'addSermon.newSermon';

/** Delivery belongs to the engine: the stage owns the new id, typing and the series choice. */
export default function AddSermonModal({ isOpen, onClose, onCancel, showTriggerButton = true, allowPlannedDate = false,
  preSelectedSeriesId, onCreated, onOpenChange }: AddSermonModalProps) {
  const { t } = useTranslation();
  const [internalOpen, setInternalOpen] = useState(false);
  const open = isOpen ?? internalOpen;
  const close = onClose ?? onCancel ?? (() => setInternalOpen(false));
  useEffect(() => { onOpenChange?.(open); }, [open, onOpenChange]);
  return <>
    {showTriggerButton && <button onClick={() => setInternalOpen(true)}
      className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 flex items-center gap-2" aria-label={t(NEW_SERMON_KEY)}>
      <PlusIcon className="w-5 h-5" /><span className="hidden sm:inline">{t(NEW_SERMON_KEY)}</span>
    </button>}
    {open && <EngineCreateSermonModal preSelectedSeriesId={preSelectedSeriesId} allowPlannedDate={allowPlannedDate}
      onClose={close} onQueued={(sermonId) => { close(); onCreated?.(sermonId); }} />}
  </>;
}
