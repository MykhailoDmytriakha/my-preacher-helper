"use client";

import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import dynamicImport from "next/dynamic";
import { createAudioThought, deleteThought, updateThought } from "@services/thought.service";
import type { Sermon, Thought } from "@/models/models";
import Link from "next/link";
import DashboardNav from "@components/DashboardNav";
import { GuestBanner } from "@components/GuestBanner";
import ExportButtons from "@components/ExportButtons";
import { log } from "@utils/logger";
import { formatDate } from "@utils/dateFormatter";
import { getTags } from "@/services/tag.service";
import useSermon from "@/hooks/useSermon";
import ThoughtCard from "@components/ThoughtCard";
import { exportSermonContent } from "@/utils/exportContent";
import AddThoughtManual from "@/components/AddThoughtManual";
import EditThoughtModal from "@components/EditThoughtModal";

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
  const router = useRouter();
  const { sermon, setSermon, loading, getSortedThoughts } = useSermon(id);
  const [allowedTags, setAllowedTags] = useState<{ name: string; color: string }[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [currentTag, setCurrentTag] = useState("");
  const [editingModalData, setEditingModalData] = useState<{ thought: Thought; index: number } | null>(null);

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
          <h2 className="text-xl font-semibold">Проповедь не найдена</h2>
          <Link
            href="/dashboard"
            className="text-blue-600 dark:text-blue-400 hover:underline mt-4 inline-block"
          >
            Вернуться к списку
          </Link>
        </div>
      </div>
    );
  }

  const formattedDate = formatDate(sermon.date);
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

  const introPercentage = totalThoughts
    ? Math.round((tagCounts["Вступление"] / totalThoughts) * 100)
    : 0;
  const mainPercentage = totalThoughts
    ? Math.round((tagCounts["Основная часть"] / totalThoughts) * 100)
    : 0;
  const conclusionPercentage = totalThoughts
    ? Math.round((tagCounts["Заключение"] / totalThoughts) * 100)
    : 0;
  const notDefinedPercentage = 100 - introPercentage - mainPercentage - conclusionPercentage;

  console.log("tagCounts", tagCounts);
  console.log("introPercentage", introPercentage);
  console.log("mainPercentage", mainPercentage);
  console.log("conclusionPercentage", conclusionPercentage);
  console.log("notDefinedPercentage", notDefinedPercentage);
  
  const introColor = allowedTags.find(t => t.name === "Вступление")?.color || "#2563eb";
  const mainColor = allowedTags.find(t => t.name === "Основная часть")?.color || "#7e22ce";
  const conclusionColor = allowedTags.find(t => t.name === "Заключение")?.color || "#16a34a";

  const handleNewRecording = async (audioBlob: Blob) => {
    log.info("handleNewRecording: Received audio blob", audioBlob);
    setIsProcessing(true);
    try {
      const thoughtResponse = await createAudioThought(audioBlob, sermon.id);
      log.info("handleNewRecording: Transcription successful", thoughtResponse);
      const newThought: Thought = { ...thoughtResponse };
      log.info("handleNewRecording: New thought created", newThought);
      setSermon((prevSermon: Sermon | null) =>
        prevSermon
          ? { ...prevSermon, thoughts: [newThought, ...prevSermon.thoughts] }
          : prevSermon
      );
    } catch (error) {
      console.error("handleNewRecording: Recording error:", error);
      alert("Ошибка обработки аудио");
    } finally {
      setIsProcessing(false);
    }
  };

  const handleDeleteThought = async (indexToDelete: number) => {
    const sortedThoughts = getSortedThoughts();
    const thoughtToDelete = sortedThoughts[indexToDelete];
    const confirmed = window.confirm(
      `Вы уверены, что хотите удалить эту запись?\n${thoughtToDelete.text}`
    );
    if (!confirmed) return;
    log.info("handleDeleteThought: Deleting thought", thoughtToDelete, indexToDelete);
    try {
      await deleteThought(sermon.id, thoughtToDelete);
      setSermon({
        ...sermon,
        thoughts: sortedThoughts.filter((_, index) => index !== indexToDelete),
      });
    } catch (error) {
      console.error("Failed to delete thought", error);
      alert("Ошибка при удалении записи. Попробуйте еще раз.");
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
      alert("Ошибка обновления записи в базе данных Firestore");
    }
  };

  const generateExportContent = async () => exportSermonContent(sermon);

  const handleNewManualThought = (newThought: Thought) => {
    setSermon({ ...sermon, thoughts: [newThought, ...sermon.thoughts] });
  };

  return (
    <div className="min-h-screen bg-white dark:bg-gray-900">
      <DashboardNav />
      <GuestBanner />
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
        <div className="flex justify-between items-start">
          <div>
            <div className="flex items-center gap-4">
              <h1 className="text-3xl font-bold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">
                {sermon.title}
              </h1>
              <ExportButtons sermonId={sermon.id} getExportContent={generateExportContent} />
            </div>
            <span className="text-sm text-gray-500 dark:text-gray-400">{formattedDate}</span>
            <div>
              {sermon.verse && (
                <p className="mt-2 text-gray-600 dark:text-gray-300 font-medium">
                  {sermon.verse}
                </p>
              )}
            </div>
          </div>
        </div>
        
        <AudioRecorder onRecordingComplete={handleNewRecording} isProcessing={isProcessing} />

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <div className="lg:col-span-2 space-y-6">
            <div className="p-6 bg-white dark:bg-gray-800 rounded-lg shadow border border-gray-200 dark:border-gray-700">
              <div className="flex justify-between items-center mb-4">
                <h2 className="text-xl font-semibold">Все записи</h2>
                <AddThoughtManual sermonId={sermon.id} onNewThought={handleNewManualThought} />
              </div>
              <div className="space-y-4">
                {sermon.thoughts.length === 0 ? (
                  <p className="text-gray-500 dark:text-gray-400">
                    Нет записей для этой проповеди.
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

          <div className="space-y-6">
            <div className="p-6 bg-white dark:bg-gray-800 rounded-lg shadow border border-gray-200 dark:border-gray-700">
              <h2 className="text-xl font-semibold mb-4">Структура проповеди</h2>
              <div className="space-y-4">
                <div className="h-3 bg-gray-200 rounded-full overflow-hidden relative">
                  <div className="absolute inset-0 flex">
                    <div
                      className="transition-all duration-500"
                      style={{
                        width: totalThoughts ? `${introPercentage}%` : "0%",
                        backgroundColor: introColor
                      }}
                      data-tooltip={`Вступление: ${tagCounts["Вступление"]} записей`}
                    />
                    <div
                      className="transition-all duration-500"
                      style={{
                        width: totalThoughts ? `${mainPercentage}%` : "0%",
                        backgroundColor: mainColor
                      }}
                      data-tooltip={`Основная часть: ${tagCounts["Основная часть"]} записей`}
                    />
                    <div
                      className="transition-all duration-500"
                      style={{
                        width: totalThoughts ? `${conclusionPercentage}%` : "0%",
                        backgroundColor: conclusionColor
                      }}
                      data-tooltip={`Заключение: ${tagCounts["Заключение"]} записей`}
                    />
                  </div>
                </div>
                <div className="flex justify-between text-sm">
                  <div className="text-center" style={{ color: introColor }}>
                    <div className="text-lg font-bold">{introPercentage}%</div>
                    <span className="text-xs text-gray-500">"Вступление" <br /> Рекомендуется: 20%</span>
                  </div>
                  <div className="border-l border-gray-200 dark:border-gray-700 mx-4" />
                  <div className="text-center" style={{ color: mainColor }}>
                    <div className="text-lg font-bold">{mainPercentage}%</div>
                    <span className="text-xs text-gray-500">
                      "Основная часть"
                      <br />
                      Рекомендуется: 60%
                    </span>
                  </div>
                  <div className="border-l border-gray-200 dark:border-gray-700 mx-4" />
                  <div className="text-center" style={{ color: conclusionColor }}>
                    <div className="text-lg font-bold">{conclusionPercentage}%</div>
                    <span className="text-xs text-gray-500">"Заключение" <br /> Рекомендуется: 20%</span>
                  </div>
                </div>
              </div>
              <button
                onClick={() => router.push(`/structure?sermonId=${sermon.id}`)}
                className="w-full mt-6 px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors"
              >
                Работать над структурой
              </button>
            </div>
            {sermon.structure && (
              <div className="p-6 bg-white dark:bg-gray-800 rounded-lg shadow border border-gray-200 dark:border-gray-700">
                <h3 className="font-semibold mb-2">Предпросмотр</h3>
                <div className="prose dark:prose-invert max-w-none">
                  {sermon.structure.introduction && (
                    <div>
                      <strong>Вступление:</strong> {sermon.structure.introduction.join(", ")}
                    </div>
                  )}
                  {sermon.structure.main && (
                    <div>
                      <strong>Основная часть:</strong> {sermon.structure.main.join(", ")}
                    </div>
                  )}
                  {sermon.structure.conclusion && (
                    <div>
                      <strong>Заключение:</strong> {sermon.structure.conclusion.join(", ")}
                    </div>
                  )}
                  {/* Only render ambiguous if it exists */}
                  {sermon.structure.ambiguous && (
                    <div>
                      <strong>На рассмотрении:</strong> {sermon.structure.ambiguous.join(", ")}
                    </div>
                  )}
                </div>
              </div>
            )}
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
