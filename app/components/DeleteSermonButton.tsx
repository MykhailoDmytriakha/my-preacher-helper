"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { deleteSermon } from "@services/sermon.service";
import { log } from "@utils/logger";

interface DeleteSermonButtonProps {
  sermonId: string;
  iconOnly?: boolean;
  noAction?: boolean;
}

export default function DeleteSermonButton({ sermonId, iconOnly, noAction }: DeleteSermonButtonProps) {
  const router = useRouter();
  const [isDeleting, setIsDeleting] = useState(false);

  const handleDelete = async () => {
    log.info(`DeleteSermonButton: handleDelete triggered for sermonId: ${sermonId}`);
    const confirmed = window.confirm("Вы уверены, что хотите удалить проповедь?");
    if (!confirmed) {
      log.info(`DeleteSermonButton: deletion cancelled for sermonId: ${sermonId}`);
      return;
    }
    log.info(`DeleteSermonButton: deletion confirmed for sermonId: ${sermonId}`);
    setIsDeleting(true);
    try {
      log.info(`DeleteSermonButton: calling deleteSermon for sermonId: ${sermonId}`);
      await deleteSermon(sermonId);
      log.info(`DeleteSermonButton: deleteSermon call completed for sermonId: ${sermonId}`);
      // Redirect to dashboard immediately after deletion
      window.location.href = '/dashboard';
    } catch (error) {
      console.error('DeleteSermonButton: Error deleting sermon:', error);
      alert('Не удалось удалить проповедь');
    } finally {
      setIsDeleting(false);
    }
  };

  if (iconOnly) {
    if (noAction) {
      return <span className="ml-2 p-1">🗑️</span>;
    }
    return (
      <button
        onClick={handleDelete}
        disabled={isDeleting}
        className="ml-2 p-1"
      >
        {isDeleting ? "..." : "🗑️"}
      </button>
    );
  }

  return (
    <button
      onClick={handleDelete}
      disabled={isDeleting}
      className="ml-2 px-3 py-1 bg-red-500 text-white rounded hover:bg-red-600"
    >
      {isDeleting ? "Удаление..." : "Удалить"}
    </button>
  );
} 