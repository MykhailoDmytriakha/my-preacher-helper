/*
  DeleteSermonButton component
  This component renders a delete button for a sermon on the dashboard page.
  When clicked, it asks the user for confirmation. If confirmed, it calls deleteSermon API function and refreshes the page using next/navigation router.refresh()
*/

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { deleteSermon } from "@services/api.service";

interface DeleteSermonButtonProps {
  sermonId: string;
}

export default function DeleteSermonButton({ sermonId }: DeleteSermonButtonProps) {
  const router = useRouter();
  const [isDeleting, setIsDeleting] = useState(false);

  const handleDelete = async () => {
    console.log(`DeleteSermonButton: handleDelete triggered for sermonId: ${sermonId}`);
    const confirmed = window.confirm("Вы уверены, что хотите удалить проповедь?");
    if (!confirmed) {
      console.log(`DeleteSermonButton: deletion cancelled for sermonId: ${sermonId}`);
      return;
    }
    console.log(`DeleteSermonButton: deletion confirmed for sermonId: ${sermonId}`);
    setIsDeleting(true);
    try {
      console.log(`DeleteSermonButton: calling deleteSermon for sermonId: ${sermonId}`);
      await deleteSermon(sermonId);
      console.log(`DeleteSermonButton: deleteSermon call completed for sermonId: ${sermonId}`);
      // Redirect to dashboard immediately after deletion
      window.location.href = '/dashboard';
    } catch (error) {
      console.error('DeleteSermonButton: Error deleting sermon:', error);
      alert('Не удалось удалить проповедь');
    } finally {
      setIsDeleting(false);
    }
  };

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