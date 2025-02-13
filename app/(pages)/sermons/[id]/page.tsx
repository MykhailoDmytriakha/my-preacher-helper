"use client";

import { useState, useRef, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import dynamicImport from "next/dynamic";
import { createAudioThought, deleteThought, updateThought, generateTags } from "@services/thought.service";
import type { Sermon, Thought } from "@/models/models";
import Link from "next/link";
import DashboardNav from "@components/DashboardNav";
import { GuestBanner } from "@components/GuestBanner";
import ExportButtons from "@components/ExportButtons";
import { log } from "@utils/logger";
import { formatDate } from "@utils/dateFormatter";
import { TrashIcon, EditIcon } from "@components/Icons";
import { getTags } from "@services/setting.service";
import useSermon from "@/hooks/useSermon";
import useEditThought from "@/hooks/useEditThought";

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
  const {
    editingIndex,
    editingText,
    editingTags,
    startEditing,
    cancelEditing,
    updateEditingText,
    updateEditingTags,
    removeEditingTag,
  } = useEditThought();
  const [allowedTags, setAllowedTags] = useState<{ name: string; color: string }[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    async function fetchAllowedTags() {
      if (editingIndex !== null && sermon) {
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
    }
    fetchAllowedTags();
  }, [editingIndex, sermon]);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = textareaRef.current.scrollHeight + "px";
    }
  }, [editingText, editingIndex]);

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
    Вступление: sermon.thoughts.reduce((count, thought) => count + (thought.tags.includes("Вступление") ? 1 : 0), 0),
    "Основная часть": sermon.thoughts.reduce((count, thought) => count + (thought.tags.includes("Основная часть") ? 1 : 0), 0),
    Заключение: sermon.thoughts.reduce((count, thought) => count + (thought.tags.includes("Заключение") ? 1 : 0), 0),
  };

  const introPercentage = totalThoughts ? Math.round((tagCounts["Вступление"] / totalThoughts) * 100) : 0;
  const mainPercentage = totalThoughts ? Math.round((tagCounts["Основная часть"] / totalThoughts) * 100) : 0;
  const conclusionPercentage = totalThoughts ? Math.round((tagCounts["Заключение"] / totalThoughts) * 100) : 0;

  const handleNewRecording = async (audioBlob: Blob) => {
    log.info("handleNewRecording: Received audio blob", audioBlob);
    setIsProcessing(true);
    try {
      const thoughtResponse = await createAudioThought(audioBlob, sermon.id);
      log.info("handleNewRecording: Transcription successful", thoughtResponse);
      const newThought: Thought = {
        ...thoughtResponse,
        date: new Date().toISOString(),
      };
      log.info("handleNewRecording: New thought created", newThought);
      setSermon((prevSermon: Sermon | null) =>
        prevSermon ? { ...prevSermon, thoughts: [newThought, ...prevSermon.thoughts] } : prevSermon
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
    const confirmed = window.confirm(`Вы уверены, что хотите удалить эту запись?\n${thoughtToDelete.text}`);
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

  const saveEditedThought = async () => {
    if (editingIndex === null) return;
    const sortedThoughts = getSortedThoughts();
    const updatedThought = {
      ...sortedThoughts[editingIndex],
      text: editingText.trim(),
      tags: editingTags,
    };
    try {
      await updateThought(sermon.id, updatedThought);
      sortedThoughts[editingIndex] = updatedThought;
      setSermon({ ...sermon, thoughts: sortedThoughts });
      cancelEditing();
    } catch (error) {
      console.error("Failed to update thought in Firestore", error);
      alert("Ошибка обновления записи в базе данных Firestore");
    }
  };

  const generateExportContent = async () => {
    const header = `Проповедь: ${sermon.title}\n${sermon.verse ? "Текст из Библии: " + sermon.verse + "\n" : ""}\n\n`;
    const content = sermon.thoughts
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
      .map((thought) => {
        return `- ${thought.text}\nТеги: ${thought.tags.join(", ")}\n`;
      })
      .join("\n");
    return header + "Размышления:\n" + content;
  };

  const handleGenerateTags = async () => {
    try {
      const tagsData = await generateTags();
      console.log("Сгенерированные метки:", tagsData);
      alert("Метки сгенерированы. Проверьте консоль.");
    } catch (error) {
      console.error("Ошибка генерации меток:", error);
      alert("Ошибка генерации меток");
    }
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
                <p className="mt-2 text-gray-600 dark:text-gray-300 font-medium">{sermon.verse}</p>
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
                <button
                  onClick={handleGenerateTags}
                  className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors"
                >
                  Сгенерировать метки
                </button>
              </div>

              <div className="space-y-4">
                {sermon.thoughts.length === 0 ? (
                  <p className="text-gray-500 dark:text-gray-400">Нет записей для этой проповеди.</p>
                ) : (
                  getSortedThoughts().map((thought, index) => (
                    <div key={index} className="relative p-4 bg-gray-50 dark:bg-gray-700 rounded-lg">
                      <div className="flex justify-between items-start mb-2">
                        <div className="flex items-center">
                          <span className="text-xs text-gray-500 dark:text-gray-400">{formatDate(thought.date)}</span>
                          <button
                            onClick={() => handleDeleteThought(index)}
                            className="hover:bg-red-200 text-white p-2 rounded"
                            style={{ marginLeft: "2px" }}
                          >
                            <TrashIcon className="w-4 h-4" fill="gray" />
                          </button>
                          <button
                            onClick={() => startEditing(thought, index)}
                            className="hover:bg-blue-200 text-white p-2 rounded"
                            style={{ marginLeft: "2px" }}
                          >
                            <EditIcon className="w-4 h-4" fill="gray" />
                          </button>
                        </div>
                        {thought.tags && thought.tags.length > 0 && (
                          <div className="flex gap-2">
                            {thought.tags.map((tag) => {
                              let bgClass, textClass, displayText;
                              if (tag === "Вступление") {
                                bgClass = "bg-blue-100 dark:bg-blue-900";
                                textClass = "text-blue-800 dark:text-blue-200";
                                displayText = tag;
                              } else if (tag === "Основная часть") {
                                bgClass = "bg-purple-100 dark:bg-purple-900";
                                textClass = "text-purple-800 dark:text-purple-200";
                                displayText = tag;
                              } else if (tag === "Заключение") {
                                bgClass = "bg-green-100 dark:bg-green-900";
                                textClass = "text-green-800 dark:text-green-200";
                                displayText = tag;
                              } else {
                                bgClass = "bg-indigo-100 dark:bg-indigo-900";
                                textClass = "text-indigo-800 dark:text-indigo-200";
                                displayText = tag;
                              }
                              return (
                                <span key={tag} className={`text-sm px-2 py-1 rounded-full ${bgClass} ${textClass}`}>
                                  {displayText}
                                </span>
                              );
                            })}
                          </div>
                        )}
                      </div>
                      {editingIndex === index ? (
                        <div>
                          <textarea
                            ref={textareaRef}
                            value={editingText}
                            onChange={(e) => updateEditingText(e.target.value)}
                            className="w-full p-2 border rounded mb-2 dark:bg-gray-800 dark:text-gray-200"
                          />
                          <div className="mb-2">
                            <p className="font-medium">Теги:</p>
                            <div className="flex flex-wrap gap-2 mt-1">
                              {editingTags.map((tag, idx) => (
                                <div
                                  key={idx}
                                  className="flex items-center bg-indigo-100 dark:bg-indigo-900 text-indigo-800 dark:text-indigo-200 px-2 py-1 rounded-full"
                                >
                                  <span>{tag}</span>
                                  <button
                                    type="button"
                                    onClick={() => removeEditingTag(idx)}
                                    className="ml-1 text-red-500 hover:text-red-700"
                                  >
                                    &times;
                                  </button>
                                </div>
                              ))}
                            </div>
                            <div className="mt-2">
                              <select
                                className="border border-gray-300 dark:border-gray-600 rounded px-2 py-1"
                                onChange={(e) => {
                                  const selectedTag = e.target.value;
                                  if (selectedTag) {
                                    updateEditingTags(selectedTag);
                                  }
                                }}
                                defaultValue=""
                              >
                                <option value="" disabled>
                                  Выберите тег для добавления
                                </option>
                                {allowedTags
                                  .filter((t) => !editingTags.includes(t.name))
                                  .map((t) => (
                                    <option key={t.name} value={t.name}>
                                      {t.name}
                                    </option>
                                  ))}
                              </select>
                              <p className="text-xs text-gray-500 mt-1">
                                Если нужный тег отсутствует, перейдите в{" "}
                                <Link href="/settings" className="text-blue-600 hover:underline">
                                  Настройки
                                </Link>
                              </p>
                            </div>
                          </div>
                          <div className="flex gap-2">
                            <button
                              onClick={saveEditedThought}
                              className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700"
                            >
                              Save
                            </button>
                            <button
                              onClick={cancelEditing}
                              className="px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700"
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      ) : (
                        <p className="text-gray-800 dark:text-gray-200">{thought.text}</p>
                      )}
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>

          <div className="space-y-6">
            <div className="p-6 bg-white dark:bg-gray-800 rounded-lg shadow border border-gray-200 dark:border-gray-700">
              <h2 className="text-xl font-semibold mb-4">Структура проповеди</h2>
              <div className="space-y-4">
                <div className="space-y-4">
                  <div className="h-3 bg-gray-200 rounded-full overflow-hidden relative">
                    <div className="absolute inset-0 flex">
                      <div
                        className="bg-blue-600 transition-all duration-500"
                        style={{ width: totalThoughts ? `${introPercentage}%` : "0%" }}
                        data-tooltip={`Вступление: ${tagCounts["Вступление"]} записей`}
                      />
                      <div
                        className="bg-purple-600 transition-all duration-500"
                        style={{ width: totalThoughts ? `${mainPercentage}%` : "0%" }}
                        data-tooltip={`Основная часть: ${tagCounts["Основная часть"]} записей`}
                      />
                      <div
                        className="bg-green-600 transition-all duration-500"
                        style={{ width: totalThoughts ? `${conclusionPercentage}%` : "0%" }}
                        data-tooltip={`Заключение: ${tagCounts["Заключение"]} записей`}
                      />
                    </div>
                  </div>
                  <div className="flex justify-between text-sm">
                    <div className="text-blue-600 text-center">
                      <div className="text-lg font-bold">{introPercentage}%</div>
                      <span className="text-xs text-gray-500">Рекомендуется: 20%</span>
                    </div>
                    <div className="border-l border-gray-200 dark:border-gray-700 mx-4" />
                    <div className="text-purple-600 text-center">
                      <div className="text-lg font-bold">{mainPercentage}%</div>
                      <span className="text-xs text-gray-500">Целевой показатель: 60%</span>
                    </div>
                    <div className="border-l border-gray-200 dark:border-gray-700 mx-4" />
                    <div className="text-green-600 text-center">
                      <div className="text-lg font-bold">{conclusionPercentage}%</div>
                      <span className="text-xs text-gray-500">Рекомендуется: 20%</span>
                    </div>
                  </div>
                </div>
              </div>
              <button 
                onClick={() => router.push(`/structure?sermonId=${sermon.id}`)}
                className="w-full mt-6 px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors"
              >
                Сгенерировать структуру
              </button>
            </div>
            {sermon.structure && (
              <div className="p-6 bg-white dark:bg-gray-800 rounded-lg shadow border border-gray-200 dark:border-gray-700">
                <h3 className="font-semibold mb-2">Предпросмотр</h3>
                <div className="prose dark:prose-invert max-w-none whitespace-pre-line">{sermon.structure}</div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
