"use client";

import React, { useState, useEffect, useRef } from "react";
import { OutlinePoint, Thought } from "@/models/models";
import { updateThought } from "@/services/thought.service";
import { useTranslation } from "react-i18next";
import { X, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

interface KeyFragmentsModalProps {
  isOpen: boolean;
  onClose: () => void;
  outlinePoint: OutlinePoint;
  thoughts: Thought[];
  sermonId: string;
  onThoughtUpdate: (updatedThought: Thought) => void;
}

interface ActiveSelection {
  text: string;
  range: Range;
  thoughtId: string;
}

const KeyFragmentsModal: React.FC<KeyFragmentsModalProps> = ({
  isOpen,
  onClose,
  outlinePoint,
  thoughts,
  sermonId,
  onThoughtUpdate,
}) => {
  const { t } = useTranslation();
  const [localThoughts, setLocalThoughts] = useState<Thought[]>(thoughts);
  const [activeSelection, setActiveSelection] = useState<ActiveSelection | null>(null);
  const selectionPopupRef = useRef<HTMLDivElement>(null);
  const modalRef = useRef<HTMLDivElement>(null);

  // Update local thoughts when props change
  useEffect(() => {
    setLocalThoughts(thoughts);
  }, [thoughts]);

  // Handle click outside to close selection popup
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        selectionPopupRef.current &&
        !selectionPopupRef.current.contains(event.target as Node)
      ) {
        setActiveSelection(null);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, []);

  // Handle escape key to close modal
  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    window.addEventListener("keydown", handleEscape);
    return () => {
      window.removeEventListener("keydown", handleEscape);
    };
  }, [onClose]);

  // Handle text selection
  const handleMouseUp = () => {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
      return;
    }

    const range = selection.getRangeAt(0);
    const selectedText = range.toString().trim();

    if (selectedText.length === 0) {
      return;
    }

    // Find which thought was selected
    let thoughtElement = range.commonAncestorContainer as HTMLElement;
    while (
      thoughtElement &&
      (!thoughtElement.dataset || !thoughtElement.dataset.thoughtId)
    ) {
      if (thoughtElement.parentElement) {
        thoughtElement = thoughtElement.parentElement;
      } else {
        break;
      }
    }

    if (
      thoughtElement &&
      thoughtElement.dataset &&
      thoughtElement.dataset.thoughtId
    ) {
      const thoughtId = thoughtElement.dataset.thoughtId;
      setActiveSelection({
        text: selectedText,
        range,
        thoughtId,
      });
    }
  };

  // Add fragment to a thought
  const handleAddFragment = async () => {
    if (!activeSelection) return;

    const { text: fragmentText, thoughtId } = activeSelection;
    const thought = localThoughts.find((t) => t.id === thoughtId);
    
    if (!thought) {
      toast.error(t("errors.thoughtNotFound"));
      setActiveSelection(null);
      return;
    }

    const newKeyFragments = [
      ...(thought.keyFragments || []),
      fragmentText,
    ];

    try {
      await updateThoughtOnBackend(thoughtId, newKeyFragments);
      setActiveSelection(null);
      toast.success(t("plan.fragmentAdded"));
    } catch (error) {
      console.error("Failed to add fragment:", error);
      toast.error(t("errors.failedToAddFragment"));
    }
  };

  // Remove fragment from a thought
  const handleRemoveFragment = async (thoughtId: string, index: number) => {
    const thought = localThoughts.find((t) => t.id === thoughtId);
    
    if (!thought || !thought.keyFragments) {
      toast.error(t("errors.thoughtNotFound"));
      return;
    }

    const newKeyFragments = thought.keyFragments.filter((_, i) => i !== index);

    try {
      await updateThoughtOnBackend(thoughtId, newKeyFragments);
      toast.success(t("plan.fragmentRemoved"));
    } catch (error) {
      console.error("Failed to remove fragment:", error);
      toast.error(t("errors.failedToRemoveFragment"));
    }
  };

  // Update thought on backend
  const updateThoughtOnBackend = async (
    thoughtId: string,
    newKeyFragments: string[]
  ) => {
    const thought = localThoughts.find((t) => t.id === thoughtId);
    
    if (!thought) {
      throw new Error("Thought not found");
    }

    const updatedThought = {
      ...thought,
      keyFragments: newKeyFragments,
    };

    const result = await updateThought(sermonId, updatedThought);
    
    // Update local state
    setLocalThoughts((prev) =>
      prev.map((t) => (t.id === thoughtId ? result : t))
    );

    // Notify parent component
    onThoughtUpdate(result);

    return result;
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
      <div
        ref={modalRef}
        className="bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-4xl max-h-[90vh] flex flex-col"
      >
        {/* Modal Header */}
        <div className="flex justify-between items-center p-4 border-b border-gray-200 dark:border-gray-700">
          <h2 className="text-xl font-semibold text-gray-800 dark:text-white">
            {t("plan.keyFragmentsFor")}: {outlinePoint.text}
          </h2>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
          >
            <X className="h-6 w-6" />
          </button>
        </div>

        {/* Modal Content */}
        <div className="p-4 overflow-y-auto flex-grow">
          <p className="mb-4 text-sm text-gray-600 dark:text-gray-300">
            {t("plan.selectTextToMarkAsKeyFragment")}
          </p>

          {localThoughts.length === 0 ? (
            <p className="text-gray-500">{t("plan.noThoughtsAssigned")}</p>
          ) : (
            <div
              data-testid="thoughts-container"
              className="space-y-6"
              onMouseUp={handleMouseUp}
            >
              {localThoughts.map((thought) => (
                <div key={thought.id} className="border rounded-lg p-4 dark:border-gray-700">
                  <h3 className="font-medium mb-2 text-gray-800 dark:text-white">
                    {t("plan.thought")}:
                  </h3>
                  
                  {/* Thought Text - Selectable */}
                  <div
                    className="mb-4 p-3 bg-gray-50 dark:bg-gray-900 rounded text-gray-800 dark:text-gray-200 user-select-text"
                    data-thought-id={thought.id}
                    data-testid={`thought-text-${thought.id}`}
                    style={{ userSelect: "text" }}
                  >
                    {thought.text}
                  </div>

                  {/* Key Fragments List */}
                  <div className="mt-2">
                    <h4 className="font-medium text-sm mb-2 text-gray-700 dark:text-gray-300">
                      {t("plan.keyFragments")}:
                    </h4>
                    
                    {thought.keyFragments && thought.keyFragments.length > 0 ? (
                      <ul className="space-y-2">
                        {thought.keyFragments.map((fragment, index) => (
                          <li
                            key={index}
                            className="flex items-center p-2 bg-blue-50 dark:bg-blue-900/20 text-blue-800 dark:text-blue-200 rounded"
                          >
                            <span className="flex-grow">{fragment}</span>
                            <button
                              onClick={() => handleRemoveFragment(thought.id, index)}
                              className="ml-2 text-red-500 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300"
                              title={t("actions.remove")}
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-sm text-gray-500 dark:text-gray-400">
                        {t("plan.noKeyFragments")}
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="border-t border-gray-200 dark:border-gray-700 p-4">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-white rounded hover:bg-gray-300 dark:hover:bg-gray-600"
          >
            {t("actions.close")}
          </button>
        </div>

        {/* Selection Popup */}
        {activeSelection && (
          <div
            ref={selectionPopupRef}
            data-testid="selection-popup"
            className="fixed bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 p-2 z-50"
            style={{
              top: `${
                activeSelection.range.getBoundingClientRect().bottom + 10
              }px`,
              left: `${
                activeSelection.range.getBoundingClientRect().left
              }px`,
            }}
          >
            <button
              onClick={handleAddFragment}
              className="flex items-center px-3 py-1 bg-blue-600 text-white rounded hover:bg-blue-700"
            >
              <Plus className="h-4 w-4 mr-1" />
              {t("plan.addAsKeyFragment")}
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default KeyFragmentsModal; 