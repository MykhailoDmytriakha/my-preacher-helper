import { useState } from "react";
import type { Thought } from "@/models/models";

function useEditThought() {
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editingText, setEditingText] = useState<string>("");
  const [editingTags, setEditingTags] = useState<string[]>([]);

  const startEditing = (thought: Thought, index: number) => {
    setEditingIndex(index);
    setEditingText(thought.text);
    setEditingTags([...thought.tags]);
  };

  const cancelEditing = () => {
    setEditingIndex(null);
    setEditingText("");
    setEditingTags([]);
  };

  const updateEditingText = (text: string) => {
    setEditingText(text);
  };

  const updateEditingTags = (tag: string) => {
    // Append tag if not already included.
    setEditingTags(prev => {
      if (!prev.includes(tag)) return [...prev, tag];
      return prev;
    });
  };

  const removeEditingTag = (index: number) => {
    setEditingTags(prev => prev.filter((_, i) => i !== index));
  };

  return {
    editingIndex,
    editingText,
    editingTags,
    startEditing,
    cancelEditing,
    updateEditingText,
    updateEditingTags,
    removeEditingTag,
  };
}

export default useEditThought;
