"use client";

import { useRouter } from "next/navigation";
import React from "react";

interface EditSermonButtonProps {
  sermonId: string;
  iconOnly?: boolean;
  noAction?: boolean;
}

export default function EditSermonButton({ sermonId, iconOnly, noAction }: EditSermonButtonProps) {
  const router = useRouter();

  const handleClick = (e: React.MouseEvent<HTMLButtonElement, MouseEvent>) => {
    e.preventDefault();
    e.stopPropagation();
    if (noAction) return;
    router.push(`/sermons/edit/${sermonId}`);
  };

  return (
    <button
      onClick={handleClick}
      className="p-1 focus:outline-none hover:bg-gray-200 rounded transition-colors duration-200"
    >
      {iconOnly ? "✏️" : "Edit Sermon"}
    </button>
  );
} 