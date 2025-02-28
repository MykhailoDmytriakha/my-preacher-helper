"use client";

import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import dynamicImport from "next/dynamic";
import { createAudioThought, deleteThought, updateThought } from "@services/thought.service";
import type { Sermon, Thought } from "@/models/models";
import Link from "next/link";
import DashboardNav from "@components/DashboardNav";
import { GuestBanner } from "@components/GuestBanner";
import { getTags } from "@/services/tag.service";
import useSermon from "@/hooks/useSermon";
import ThoughtCard from "@components/ThoughtCard";
import AddThoughtManual from "@/components/AddThoughtManual";
import EditThoughtModal from "@components/EditThoughtModal";
import SermonHeader from "@/components/sermon/SermonHeader";
import KnowledgeSection from "@/components/sermon/KnowledgeSection";
import StructureStats from "@/components/sermon/StructureStats";
import { useTranslation } from 'react-i18next';
import "@locales/i18n";
export const dynamic = "force-dynamic";

const AudioRecorder = dynamicImport(
  () => import("@components/AudioRecorder").then((mod) => mod.AudioRecorder),
  {
    ssr: false,
    loading: () => <p>Loading recorder...</p>,
  }
);

export default function SermonPage() {
  const { id } = useParams<{ id: string }>();
  const { sermon, setSermon, loading, getSortedThoughts } = useSermon(id);
  const [allowedTags, setAllowedTags] = useState<{ name: string; color: string }[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [editingModalData, setEditingModalData] = useState<{ thought: Thought; index: number } | null>(null);
  const { t } = useTranslation();
  const [isMounted, setIsMounted] = useState(false);

  useEffect(() => {
    setIsMounted(true);
  }, []);

  useEffect(() => {
    const fetchAllowedTags = async () => {
      if (sermon) {
        try {
          const tagData = await getTags(sermon.userId);
          const combinedTags = [
            ...tagData.requiredTags.map((t: any) => ({ name: t.name, color: t.color })),
            ...tagData.customTags.map((t: any) => ({ name: t.name, color: t.color })),
          ];
          setAllowedTags(combinedTags);
        } catch (error) {
          console.error("Error fetching allowed tags:", error);
        }
      }
    };
    fetchAllowedTags();
  }, [sermon]);

  if (loading || !sermon) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="p-6 bg-white dark:bg-gray-800 rounded-lg shadow border border-gray-200 dark:border-gray-700">
          {isMounted ? (
            <>
              <h2 className="text-xl font-semibold">{t('settings.loading')}</h2>
              <Link href="/dashboard" className="text-blue-600 dark:text-blue-400 hover:underline mt-4 inline-block">
                {t('sermon.backToList')}
              </Link>
            </>
          ) : (
            <div className="animate-pulse">
              <div className="h-6 bg-gray-300 dark:bg-gray-600 rounded w-1/3 mb-4"></div>
              <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-1/4"></div>
            </div>
          )}
        </div>
      </div>
    );
  }

  if (!sermon.thoughts) {
    sermon.thoughts = [];
  }
  const totalThoughts = sermon.thoughts.length;
  const tagCounts = {
    "Вступление": sermon.thoughts.reduce(
      (count, thought) => count + (thought.tags.includes("Вступление") ? 1 : 0),
      0
    ),
    "Основная часть": sermon.thoughts.reduce(
      (count, thought) => count + (thought.tags.includes("Основная часть") ? 1 : 0),
      0
    ),
    "Заключение": sermon.thoughts.reduce(
      (count, thought) => count + (thought.tags.includes("Заключение") ? 1 : 0),
      0
    ),
  };

  const handleNewRecording = async (audioBlob: Blob) => {
    setIsProcessing(true);
    try {
      const thoughtResponse = await createAudioThought(audioBlob, sermon.id);
      const newThought: Thought = { ...thoughtResponse };
      setSermon((prevSermon: Sermon | null) =>
        prevSermon
          ? { ...prevSermon, thoughts: [newThought, ...prevSermon.thoughts] }
          : prevSermon
      );
    } catch (error) {
      console.error("handleNewRecording: Recording error:", error);
      alert(t('errors.audioProcessing'));
    } finally {
      setIsProcessing(false);
    }
  };

  const handleDeleteThought = async (indexToDelete: number) => {
    const sortedThoughts = getSortedThoughts();
    const thoughtToDelete = sortedThoughts[indexToDelete];
    const confirmed = window.confirm(t('sermon.deleteThoughtConfirm', { text: thoughtToDelete.text }));
    if (!confirmed) return;
    try {
      await deleteThought(sermon.id, thoughtToDelete);
      setSermon({
        ...sermon,
        thoughts: sortedThoughts.filter((_, index) => index !== indexToDelete),
      });
    } catch (error) {
      console.error("Failed to delete thought", error);
      alert(t('errors.thoughtDeleteError'));
    }
  };

  const handleSaveEditedThought = async (updatedText: string, updatedTags: string[]) => {
    if (!editingModalData) return;
    const sortedThoughts = getSortedThoughts();
    const { index } = editingModalData;
    const updatedThought = { ...sortedThoughts[index], text: updatedText.trim(), tags: updatedTags };
    try {
      await updateThought(sermon.id, updatedThought);
      sortedThoughts[index] = updatedThought;
      setSermon({ ...sermon, thoughts: sortedThoughts });
      setEditingModalData(null);
    } catch (error) {
      console.error("Failed to update thought", error);
      alert(t('errors.thoughtUpdateError'));
    }
  };

  const handleNewManualThought = (newThought: Thought) => {
    setSermon({ ...sermon, thoughts: [newThought, ...sermon.thoughts] });
  };

  return (
    <div className="min-h-screen bg-white dark:bg-gray-900">
      <DashboardNav />
      <GuestBanner />
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
        <SermonHeader sermon={sermon} />
        
        <AudioRecorder onRecordingComplete={handleNewRecording} isProcessing={isProcessing} />

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <div className="lg:col-span-2 space-y-6">
            <div className="p-6 bg-white dark:bg-gray-800 rounded-lg shadow border border-gray-200 dark:border-gray-700">
              <div className="flex justify-between items-center mb-5">
                <div className="flex items-center gap-2">
                  <h2 className="text-xl font-semibold">{t('sermon.allThoughts')}</h2>
                  <span className="inline-flex items-center justify-center px-2.5 py-0.5 rounded-full text-sm font-medium bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200">
                    {totalThoughts}
                  </span>
                </div>
                <AddThoughtManual sermonId={sermon.id} onNewThought={handleNewManualThought} />
              </div>
              <div className="space-y-5">
                {sermon.thoughts.length === 0 ? (
                  <div className="text-center py-8 border border-dashed border-gray-300 dark:border-gray-700 rounded-lg">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-12 w-12 mx-auto text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                    </svg>
                    <p className="mt-2 text-gray-500 dark:text-gray-400">
                      {t('sermon.noThoughts')}
                    </p>
                  </div>
                ) : (
                  getSortedThoughts().map((thought, index) => {
                    const requiredTags = ["Вступление", "Основная часть", "Заключение"];
                    const hasRequiredTag = thought.tags.some((tag) =>
                      requiredTags.includes(tag)
                    );

                    return (
                      <ThoughtCard
                        key={index}
                        thought={thought}
                        index={index}
                        editingIndex={null}
                        editingText={""}
                        editingTags={[]}
                        hasRequiredTag={hasRequiredTag}
                        allowedTags={allowedTags}
                        currentTag={""}
                        onDelete={handleDeleteThought}
                        onEditStart={(thought, index) => setEditingModalData({ thought, index })}
                        onEditCancel={() => {}}
                        onEditSave={() => {}}
                        onTextChange={() => {}}
                        onRemoveTag={() => {}}
                        onAddTag={() => {}}
                        onTagSelectorChange={() => {}}
                        setCurrentTag={() => {}}
                      />
                    );
                  })
                )}
              </div>
            </div>
          </div>

          <div className="space-y-6">
            <KnowledgeSection sermon={sermon} />
            <StructureStats sermon={sermon} tagCounts={tagCounts} totalThoughts={totalThoughts} />
          </div>
        </div>
      </div>
      {editingModalData && (
        <EditThoughtModal
          initialText={editingModalData.thought.text}
          initialTags={editingModalData.thought.tags}
          allowedTags={allowedTags}
          onSave={handleSaveEditedThought}
          onClose={() => setEditingModalData(null)}
        />
      )}
    </div>
  );
}
