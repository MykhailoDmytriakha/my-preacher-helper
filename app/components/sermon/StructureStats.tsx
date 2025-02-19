"use client";

import React from "react";
import { useRouter, useParams } from "next/navigation";
import type { Sermon } from "@/models/models";

interface StructureStatsProps {
  sermon: Sermon;
  tagCounts: {
    [key: string]: number;
  };
  totalThoughts: number;
}

const StructureStats: React.FC<StructureStatsProps> = ({
  sermon,
  tagCounts,
  totalThoughts,
}) => {
  const router = useRouter();
  const { id } = useParams() as { id: string };

  const intro = tagCounts["Вступление"] || 0;
  const main = tagCounts["Основная часть"] || 0;
  const conclusion = tagCounts["Заключение"] || 0;

  const introPercentage = totalThoughts
    ? Math.round((intro / totalThoughts) * 100)
    : 0;
  const mainPercentage = totalThoughts
    ? Math.round((main / totalThoughts) * 100)
    : 0;
  const conclusionPercentage = totalThoughts
    ? Math.round((conclusion / totalThoughts) * 100)
    : 0;

  // Default colors
  const introColor = "#2563eb";
  const mainColor = "#7e22ce";
  const conclusionColor = "#16a34a";

  return (
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
                  backgroundColor: introColor,
                }}
                data-tooltip={`Вступление: ${tagCounts["Вступление"]} записей`}
              />
              <div
                className="transition-all duration-500"
                style={{
                  width: totalThoughts ? `${mainPercentage}%` : "0%",
                  backgroundColor: mainColor,
                }}
                data-tooltip={`Основная часть: ${tagCounts["Основная часть"]} записей`}
              />
              <div
                className="transition-all duration-500"
                style={{
                  width: totalThoughts ? `${conclusionPercentage}%` : "0%",
                  backgroundColor: conclusionColor,
                }}
                data-tooltip={`Заключение: ${tagCounts["Заключение"]} записей`}
              />
            </div>
          </div>
          <div className="flex justify-between text-sm">
            <div className="text-center" style={{ color: introColor }}>
              <div className="text-lg font-bold">{introPercentage}%</div>
              <span className="text-xs text-gray-500">
                "Вступление" <br /> Рекомендуется: 20%
              </span>
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
              <span className="text-xs text-gray-500">
                "Заключение" <br /> Рекомендуется: 20%
              </span>
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
                <strong>Вступление:</strong>{" "}
                {sermon.structure.introduction.join(", ")}
              </div>
            )}
            {sermon.structure.main && (
              <div>
                <strong>Основная часть:</strong>{" "}
                {sermon.structure.main.join(", ")}
              </div>
            )}
            {sermon.structure.conclusion && (
              <div>
                <strong>Заключение:</strong>{" "}
                {sermon.structure.conclusion.join(", ")}
              </div>
            )}
            {/* Only render ambiguous if it exists */}
            {sermon.structure.ambiguous && (
              <div>
                <strong>На рассмотрении:</strong>{" "}
                {sermon.structure.ambiguous.join(", ")}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default StructureStats;
