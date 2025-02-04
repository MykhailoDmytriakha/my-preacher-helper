"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import dynamicImport from "next/dynamic";
import { getSermonById, transcribeAudioToNote, deleteThought } from "@services/api.service";
import type { Sermon, Thought } from "@/models/models";
import Link from "next/link";
import DashboardNav from "@components/DashboardNav";
import { GuestBanner } from "@components/GuestBanner";
import ExportButtons from "@components/ExportButtons";

// Force dynamic rendering
export const dynamic = "force-dynamic";

// Dynamic import of the AudioRecorder component with isProcessing prop support
const AudioRecorder = dynamicImport(
  () => import("@components/AudioRecorder").then((mod) => mod.AudioRecorder),
  {
    ssr: false,
    loading: () => <p>Loading recorder...</p>,
  }
);

export default function SermonPage() {
  const { id } = useParams<{ id: string }>();
  const [sermon, setSermon] = useState<Sermon | null>(null);
  const [isProcessing, setIsProcessing] = useState(false); // State to track audio processing

  useEffect(() => {
    const loadSermon = async () => {
      const data = await getSermonById(id);
      setSermon(data || null);
    };
    loadSermon();
  }, [id]);

  if (!sermon) {
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

  // Format the sermon date (e.g., "01.02.2025, 11:47")
  const formattedDate = new Date(sermon.date).toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

  const totalThoughts = sermon.thoughts.length;

  // Calculate tag counts for the progress bar (based on primary tags)
  const tagCounts = {
    Вступление: sermon.thoughts.reduce(
      (count, thought) => count + (thought.tags.includes("Вступление") ? 1 : 0),
      0
    ),
    "Основная часть": sermon.thoughts.reduce(
      (count, thought) =>
        count + (thought.tags.includes("Основная часть") ? 1 : 0),
      0
    ),
    Заключение: sermon.thoughts.reduce(
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

  // Updated function to handle new audio recording
  const handleNewRecording = async (audioBlob: Blob) => {
    console.log("handleNewRecording: Received audio blob", audioBlob);
    setIsProcessing(true); // Enable processing state
    try {
      // Get the Thought object (includes text and tags) from the transcription service
      const thoughtResponse = await transcribeAudioToNote(audioBlob, sermon.id);
      console.log(
        "handleNewRecording: Transcription successful",
        thoughtResponse
      );
      const newThought: Thought = {
        ...thoughtResponse,
        date: new Date().toISOString(),
      };
      console.log("handleNewRecording: New thought created", newThought);
      // Update the sermon state by appending the new thought
      setSermon((prevSermon: Sermon | null) =>
        prevSermon
          ? { ...prevSermon, thoughts: [newThought, ...prevSermon.thoughts] }
          : prevSermon
      );
    } catch (error) {
      console.error("handleNewRecording: Recording error:", error);
      alert("Ошибка обработки аудио");
    } finally {
      setIsProcessing(false); // Disable processing state
    }
  };

  const handleDeleteThought = async (indexToDelete: number) => {
    if (!sermon) return;
    sermon.thoughts.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    const thoughtToDelete = sermon.thoughts[indexToDelete];
    console.log("handleDeleteThought: Deleting thought", thoughtToDelete, indexToDelete);
    try {
      await deleteThought(sermon.id, thoughtToDelete);
      setSermon({
        ...sermon,
        thoughts: sermon.thoughts.filter((_, index) => index !== indexToDelete),
      });
    } catch (error) {
      console.error("Failed to delete thought", error);
      alert("Ошибка при удалении записи. Попробуйте еще раз.");
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
                {/* TODO: Make the title and verse editable */}
                {sermon.title}
              </h1>
              <ExportButtons sermonId={sermon.id} />
            </div>
            <span className="text-sm text-gray-500 dark:text-gray-400">
              {formattedDate}
            </span>
            <div>
              {sermon.verse && (
                <p className="mt-2 text-gray-600 dark:text-gray-300 font-medium">
                  {sermon.verse}
                </p>
              )}
            </div>
          </div>
        </div>

        {/* Pass the isProcessing state to the AudioRecorder */}
        <AudioRecorder
          onRecordingComplete={handleNewRecording}
          isProcessing={isProcessing}
        />

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Left column – Raw entries */}
          <div className="lg:col-span-2 space-y-6">
            <div className="p-6 bg-white dark:bg-gray-800 rounded-lg shadow border border-gray-200 dark:border-gray-700">
              <div className="flex justify-between items-center mb-4">
                <h2 className="text-xl font-semibold">Все записи</h2>
              </div>

              <div className="space-y-4">
                {sermon.thoughts.length === 0 ? (
                  <p className="text-gray-500 dark:text-gray-400">
                    Нет записей для этой проповеди.
                  </p>
                ) : (
                  [...sermon.thoughts]
                    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
                    .map((thought, index) => (
                      <div
                        key={index}
                        className="relative p-4 bg-gray-50 dark:bg-gray-700 rounded-lg"
                      >
                        <div className="flex justify-between items-start mb-2">
                          <div className="flex items-center">
                            <span className="text-xs text-gray-500 dark:text-gray-400">
                              {new Date(thought.date).toLocaleTimeString("ru-RU", {
                                day: "2-digit",
                                month: "2-digit",
                                year: "numeric",
                                hour: "2-digit",
                                minute: "2-digit",
                                hour12: false,
                              })}
                            </span>
                            <button
                              onClick={() => handleDeleteThought(index)}
                              className="hover:bg-red-200 text-white p-2 rounded"
                              style={{ marginLeft: '2px' }}
                            >
                              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4">
                                <path xmlns="http://www.w3.org/2000/svg" d="M18 6L17.1991 18.0129C17.129 19.065 17.0939 19.5911 16.8667 19.99C16.6666 20.3412 16.3648 20.6235 16.0011 20.7998C15.588 21 15.0607 21 14.0062 21H9.99377C8.93927 21 8.41202 21 7.99889 20.7998C7.63517 20.6235 7.33339 20.3412 7.13332 19.99C6.90607 19.5911 6.871 19.065 6.80086 18.0129L6 6M4 6H20M16 6L15.7294 5.18807C15.4671 4.40125 15.3359 4.00784 15.0927 3.71698C14.8779 3.46013 14.6021 3.26132 14.2905 3.13878C13.9376 3 13.523 3 12.6936 3H11.3064C10.477 3 10.0624 3 9.70951 3.13878C9.39792 3.26132 9.12208 3.46013 8.90729 3.71698C8.66405 4.00784 8.53292 4.40125 8.27064 5.18807L8 6" stroke="#000000" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                              </svg>
                            </button>
                          </div>
                          {/* Display tags: iterate over thought.tags and style based on tag value */}
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
                                  // Дополнительные теги отображаются в индиго для лучшего контраста с фоном
                                  bgClass = "bg-indigo-100 dark:bg-indigo-900";
                                  textClass = "text-indigo-800 dark:text-indigo-200";
                                  displayText = tag;
                                }
                                return (
                                  <span
                                    key={tag}
                                    className={`text-sm px-2 py-1 rounded-full ${bgClass} ${textClass}`}
                                  >
                                    {displayText}
                                  </span>
                                );
                              })}
                            </div>
                          )}
                        </div>
                        <p className="text-gray-800 dark:text-gray-200">
                          {thought.text}
                        </p>
                      </div>
                    ))
                )}
              </div>
            </div>
          </div>

          {/* Right column – Sermon structure */}
          <div className="space-y-6">
            <div className="p-6 bg-white dark:bg-gray-800 rounded-lg shadow border border-gray-200 dark:border-gray-700">
              <h2 className="text-xl font-semibold mb-4">
                Структура проповеди
              </h2>

              <div className="space-y-4">
                <div className="space-y-4">
                  <div className="h-3 bg-gray-200 rounded-full overflow-hidden relative">
                    <div className="absolute inset-0 flex">
                      <div
                        className="bg-blue-600 transition-all duration-500"
                        style={{
                          width: totalThoughts ? `${introPercentage}%` : "0%",
                        }}
                        data-tooltip={`Вступление: ${tagCounts["Вступление"]} записей`}
                      />
                      <div
                        className="bg-purple-600 transition-all duration-500"
                        style={{
                          width: totalThoughts ? `${mainPercentage}%` : "0%",
                        }}
                        data-tooltip={`Основная часть: ${tagCounts["Основная часть"]} записей`}
                      />
                      <div
                        className="bg-green-600 transition-all duration-500"
                        style={{
                          width: totalThoughts
                            ? `${conclusionPercentage}%`
                            : "0%",
                        }}
                        data-tooltip={`Заключение: ${tagCounts["Заключение"]} записей`}
                      />
                    </div>
                  </div>

                  <div className="flex justify-between text-sm">
                    <div className="text-blue-600 text-center">
                      <div className="text-lg font-bold">
                        {introPercentage}%
                      </div>
                      <span className="text-xs text-gray-500">
                        Рекомендуется: 20%
                      </span>
                    </div>

                    <div className="border-l border-gray-200 dark:border-gray-700 mx-4" />

                    <div className="text-purple-600 text-center">
                      <div className="text-lg font-bold">{mainPercentage}%</div>
                      <span className="text-xs text-gray-500">
                        Целевой показатель: 60%
                      </span>
                    </div>

                    <div className="border-l border-gray-200 dark:border-gray-700 mx-4" />

                    <div className="text-green-600 text-center">
                      <div className="text-lg font-bold">
                        {conclusionPercentage}%
                      </div>
                      <span className="text-xs text-gray-500">
                        Рекомендуется: 20%
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              <button className="w-full mt-6 px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors">
                Сгенерировать структуру
              </button>
            </div>

            {sermon.structure && (
              <div className="p-6 bg-white dark:bg-gray-800 rounded-lg shadow border border-gray-200 dark:border-gray-700">
                <h3 className="font-semibold mb-2">Предпросмотр</h3>
                <div className="prose dark:prose-invert max-w-none whitespace-pre-line">
                  {sermon.structure}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
