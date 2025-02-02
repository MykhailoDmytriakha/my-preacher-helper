"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import dynamicImport from "next/dynamic";
import { getSermonById, Thought } from "@services/api.service";
import Link from "next/link";
import DashboardNav from "@components/DashboardNav";
import { GuestBanner } from "@components/GuestBanner";
import { Sermon } from "@services/api.service";
import { transcribeAudioToNote } from "@services/api.service";
import ExportButtons from "@components/ExportButtons";

export const dynamic = "force-dynamic";

// Correct dynamic import with named export handling
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

  // Format the sermon date to display digits only.
  // This will output format like "01.02.2025, 11:47"
  const formattedDate = new Date(sermon.date).toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

  const totalThoughts = sermon.thoughts.length;

  const tagCounts = {
    introduction: sermon.thoughts.filter((t) => t.tag === "introduction")
      .length,
    main: sermon.thoughts.filter((t) => t.tag === "main").length,
    conclusion: sermon.thoughts.filter((t) => t.tag === "conclusion").length,
  };

  const introPercentage = totalThoughts
    ? Math.round((tagCounts.introduction / totalThoughts) * 100)
    : 0;
  const mainPercentage = totalThoughts
    ? Math.round((tagCounts.main / totalThoughts) * 100)
    : 0;
  const conclusionPercentage = totalThoughts
    ? Math.round((tagCounts.conclusion / totalThoughts) * 100)
    : 0;

  const handleNewRecording = async (audioBlob: Blob) => {
    console.log("handleNewRecording: Received audio blob", audioBlob);
    try {
      const text = await transcribeAudioToNote(audioBlob, sermon.id);
      // TODO: until we waiting on response let's change button on "Thinking" on light blue color
      console.log("handleNewRecording: Transcription successful", text);
      // Формируем новую мысль
      const newThought: Thought = {
        text,
        tag: "introduction" as const,
        date: new Date().toISOString(),
      };
      console.log("handleNewRecording: New thought created", newThought);
      // Update the sermon by appending the new thought
      setSermon((prevSermon) =>
        prevSermon
          ? { ...prevSermon, thoughts: [...prevSermon.thoughts, newThought] }
          : prevSermon
      );
    } catch (error) {
      console.error("handleNewRecording: Recording error:", error);
      alert("Ошибка обработки аудио");
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
                {/* TODO: it should be editable TITLE and VERSE */}
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

        <AudioRecorder onRecordingComplete={handleNewRecording} />

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Левая колонка - Сырые мысли */}
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
                  sermon.thoughts.map((thought, index) => (
                    // TODO: we should have ability to edit thoughts and delete them
                    <div
                      key={index}
                      className="p-4 bg-gray-50 dark:bg-gray-700 rounded-lg"
                    >
                      <div className="flex justify-between items-start mb-2">
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
                        {thought.tag !== "auto-generated" && (
                          <span
                            className={`text-sm px-2 py-1 rounded-full ${thought.tag === "introduction"
                              ? "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200"
                              : thought.tag === "main"
                                ? "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200"
                                : "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200"
                              }`}
                          >
                            {thought.tag === "introduction"
                              ? "Вступление"
                              : thought.tag === "main"
                                ? "Основная часть"
                                : "Заключение"}
                          </span>
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

          {/* Правая колонка - Структура */}
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
                        data-tooltip={`Вступление: ${tagCounts.introduction} записей`}
                      />
                      <div
                        className="bg-purple-600 transition-all duration-500"
                        style={{
                          width: totalThoughts ? `${mainPercentage}%` : "0%",
                        }}
                        data-tooltip={`Основная часть: ${tagCounts.main} записей`}
                      />
                      <div
                        className="bg-green-600 transition-all duration-500"
                        style={{
                          width: totalThoughts
                            ? `${conclusionPercentage}%`
                            : "0%",
                        }}
                        data-tooltip={`Заключение: ${tagCounts.conclusion} записей`}
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
