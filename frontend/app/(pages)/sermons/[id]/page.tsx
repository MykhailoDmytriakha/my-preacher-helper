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
              <h2 className="text-xl font-semibold">{t('sermon.notFound')}</h2>
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
              <div className="flex justify-between items-center mb-4">
                <h2 className="text-xl font-semibold">{t('sermon.allThoughts')}</h2>
                <AddThoughtManual sermonId={sermon.id} onNewThought={handleNewManualThought} />
              </div>
              <div className="space-y-4">
                {sermon.thoughts.length === 0 ? (
                  <p className="text-gray-500 dark:text-gray-400">
                    {t('sermon.noThoughts')}
                  </p>
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

          <StructureStats sermon={sermon} tagCounts={tagCounts} totalThoughts={totalThoughts} />
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
