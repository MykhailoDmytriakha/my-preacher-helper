"use client";

import { useState, useCallback, useEffect } from "react";
import { toast } from "sonner";

import { Sermon, SermonPoint, Thought, SermonDraft } from "@/models/models";

interface UsePlanOptions {
  sermon: Sermon | null;
  sermonId: string;
}

export const usePlan = ({ sermon }: UsePlanOptions) => {
  // State for generated content
  const [generatedContent, setGeneratedContent] = useState<Record<string, string>>({});
  const [modifiedContent, setModifiedContent] = useState<Record<string, boolean>>({});
  const [savedSermonPoints, setSavedSermonPoints] = useState<Record<string, boolean>>({});
  const [editModePoints, setEditModePoints] = useState<Record<string, boolean>>({});
  const [generatingId, setGeneratingId] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  // Load existing content when sermon changes
  useEffect(() => {
    const draft = sermon?.draft || sermon?.plan;
    if (draft) {
      const content: Record<string, string> = {};
      const saved: Record<string, boolean> = {};

      // Load content from all sections
      ['introduction', 'main', 'conclusion'].forEach(section => {
        const sectionData = draft?.[section as keyof SermonDraft];
        if (sectionData?.outlinePoints) {
          Object.entries(sectionData.outlinePoints).forEach(([id, pointContent]) => {
            content[id] = pointContent;
            saved[id] = true;
          });
        }
      });

      setGeneratedContent(content);
      setSavedSermonPoints(saved);
    }
  }, [sermon]);

  // Get thoughts for a specific outline point
  const getThoughtsForSermonPoint = useCallback((outlinePointId: string): Thought[] => {
    if (!sermon?.thoughts) return [];
    return sermon.thoughts.filter(thought => thought.outlinePointId === outlinePointId);
  }, [sermon?.thoughts]);

  // Generate content for an outline point
  const generateSermonPointContent = useCallback(async (outlinePointId: string) => {
    if (!sermon) return;
    
    setGeneratingId(outlinePointId);
    
    try {
      // Find the outline point in the sermon structure
      let outlinePoint: SermonPoint | undefined;
      let section: string | undefined;
      
      if (sermon.outline?.introduction.some((op) => op.id === outlinePointId)) {
        outlinePoint = sermon.outline.introduction.find((op) => op.id === outlinePointId);
        section = "introduction";
      } else if (sermon.outline?.main.some((op) => op.id === outlinePointId)) {
        outlinePoint = sermon.outline.main.find((op) => op.id === outlinePointId);
        section = "main";
      } else if (sermon.outline?.conclusion.some((op) => op.id === outlinePointId)) {
        outlinePoint = sermon.outline.conclusion.find((op) => op.id === outlinePointId);
        section = "conclusion";
      }
      
      if (!outlinePoint || !section) {
        toast.error("SermonOutline point not found");
        return;
      }
      
      // Call the API to generate content
      const response = await fetch(`/api/sermons/${sermon.id}/plan?outlinePointId=${outlinePointId}`, {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
        },
      });
      
      if (!response.ok) {
        throw new Error(`Failed to generate content: ${response.status}`);
      }
      
      const data = await response.json();
      
      // Update the generated content
      setGeneratedContent((prev) => ({
        ...prev,
        [outlinePointId]: data.content,
      }));
      
      // Mark content as modified since it was just generated
      setModifiedContent(prev => ({
        ...prev,
        [outlinePointId]: true
      }));
      
      toast.success("Content generated successfully!");
    } catch (err) {
      console.error(err);
      toast.error("Failed to generate content");
    } finally {
      setGeneratingId(null);
    }
  }, [sermon]);

  // Save an individual outline point
  const saveSermonPoint = useCallback(async (
    outlinePointId: string, 
    content: string, 
    section: keyof SermonDraft
  ) => {
    if (!sermon) return;

    try {
      // First fetch the latest sermon plan from server to avoid overwriting recent changes
      const latestSermonResponse = await fetch(`/api/sermons/${sermon.id}`);
      if (!latestSermonResponse.ok) {
        throw new Error(`Failed to fetch latest sermon data: ${latestSermonResponse.status}`);
      }
      
      const latestSermon = await latestSermonResponse.json();
      const latestDraft = latestSermon.draft || latestSermon.plan;
      
      // Create draft object if it doesn't exist
      const currentPlan = latestDraft || {
        introduction: { outline: "" },
        main: { outline: "" },
        conclusion: { outline: "" }
      };
      
      // Preserve existing outline points and add/update the new one
      const existingSermonPoints = currentPlan[section]?.outlinePoints || {};
      
      // Update the outline point in the plan
      const updatedPlan: SermonDraft = {
        ...currentPlan,
        [section]: {
          ...currentPlan[section],
          outlinePoints: {
            ...existingSermonPoints,
            [outlinePointId]: content
          }
        }
      };
      
      // Send the updated plan to the server
      const response = await fetch(`/api/sermons/${sermon.id}/plan`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(updatedPlan),
      });
      
      if (!response.ok) {
        throw new Error(`Failed to save outline point: ${response.status}`);
      }
      
      // Mark this point as saved
      setSavedSermonPoints(prev => ({...prev, [outlinePointId]: true}));
      
      // Mark content as unmodified since it's now saved
      setModifiedContent(prev => ({...prev, [outlinePointId]: false}));
      
      toast.success("SermonOutline point saved successfully!");
    } catch (error) {
      console.error("Failed to save outline point:", error);
      toast.error("Failed to save outline point");
    }
  }, [sermon]);

  // Helper functions
  const findSectionForSermonPoint = useCallback((outlinePointId: string): string | null => {
    if (!sermon?.outline) return null;
    
    if (sermon.outline.introduction.some(op => op.id === outlinePointId)) return 'introduction';
    if (sermon.outline.main.some(op => op.id === outlinePointId)) return 'main';
    if (sermon.outline.conclusion.some(op => op.id === outlinePointId)) return 'conclusion';
    
    return null;
  }, [sermon?.outline]);

  const findSermonPointById = useCallback((outlinePointId: string): SermonPoint | undefined => {
    if (!sermon?.outline) return undefined;
    
    const sections = [sermon.outline.introduction, sermon.outline.main, sermon.outline.conclusion];
    for (const section of sections) {
      const point = section.find(op => op.id === outlinePointId);
      if (point) return point;
    }
    return undefined;
  }, [sermon?.outline]);

  const savePlan = useCallback(async () => {
    setIsSaving(true);
    try {
      // Save all modified outline points
      const savePromises = Object.entries(generatedContent)
        .filter(([id]) => modifiedContent[id])
        .map(([id, content]) => {
          const section = findSectionForSermonPoint(id);
          if (section) {
            return saveSermonPoint(id, content, section as keyof SermonDraft);
          }
          return Promise.resolve();
        });

      await Promise.all(savePromises);
      toast.success("SermonDraft saved successfully!");
    } catch (error) {
      console.error("Failed to save plan:", error);
      toast.error("Failed to save plan");
    } finally {
      setIsSaving(false);
    }
  }, [generatedContent, modifiedContent, saveSermonPoint, findSectionForSermonPoint]);

  // Toggle edit mode for a point
  const toggleEditMode = useCallback((outlinePointId: string) => {
    setEditModePoints(prev => ({
      ...prev,
      [outlinePointId]: !prev[outlinePointId]
    }));
  }, []);

  // Handle content change
  const handleContentChange = useCallback((outlinePointId: string, content: string) => {
    setGeneratedContent(prev => ({
      ...prev,
      [outlinePointId]: content,
    }));
    
    // Check if content is modified from saved version
    const section = findSectionForSermonPoint(outlinePointId);
    if (section) {
      const savedContent = sermon?.plan?.[section as keyof SermonDraft]?.outlinePoints?.[outlinePointId] || "";
      const isModified = content !== savedContent;
      
      setModifiedContent(prev => ({
        ...prev,
        [outlinePointId]: isModified
      }));
    }
  }, [sermon?.plan, findSectionForSermonPoint]);

  // Check if there are unsaved changes
  const hasUnsavedChanges = Object.values(modifiedContent).some(isModified => isModified);

  return {
    // State
    generatedContent,
    modifiedContent,
    savedSermonPoints,
    editModePoints,
    generatingId,
    isSaving,
    hasUnsavedChanges,
    
    // Actions
    generateSermonPointContent,
    saveSermonPoint,
    savePlan,
    toggleEditMode,
    handleContentChange,
    getThoughtsForSermonPoint,
    
    // Helpers
    findSermonPointById,
    findSectionForSermonPoint,
  };
}; 
