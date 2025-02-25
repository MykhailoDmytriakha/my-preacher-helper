"use client";

import React from "react";
import { useDroppable } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import SortableItem from "./SortableItem";
import { Item } from "@/models/models";
import { useTranslation } from 'react-i18next';
import "@locales/i18n";

interface ColumnProps {
  id: string;
  title: string;
  items: Item[];
  headerColor?: string; // optional color for header and border
  onEdit?: (item: Item) => void;
}

export default function Column({ id, title, items, headerColor, onEdit }: ColumnProps) {
  const { setNodeRef, isOver } = useDroppable({ id, data: { container: id } });
  const { t } = useTranslation();
  return (
    <div className="flex flex-col">
      <div className="mb-2">
        <h2
          className={`text-xl font-semibold text-white p-3 rounded-t-md shadow ${
            !headerColor
              ? {
                  introduction: "bg-blue-600",
                  main: "bg-purple-600",
                  conclusion: "bg-green-600",
                  ambiguous: "bg-gray-600",
                }[id]
              : ""
          }`}
          style={headerColor ? { backgroundColor: headerColor } : {}}
        >
          {title}
        </h2>
      </div>
      <SortableContext items={items} strategy={verticalListSortingStrategy}>
        <div
          ref={setNodeRef}
          className={`min-h-[300px] p-4 bg-white rounded-b-md border-2 shadow-lg transition-all ${
            !headerColor
              ? {
                  introduction: "border-blue-200",
                  main: "border-purple-200", 
                  conclusion: "border-green-200",
                  ambiguous: "border-gray-200",
                }[id]
              : ""
          } ${isOver ? "ring-2 ring-blue-400" : ""}`}
          style={headerColor ? { borderColor: headerColor } : {}}
        >
          {items.length === 0 ? (
            <div className="p-4 text-center text-gray-500 border-dashed border-2 border-blue-300">
              {t('structure.noEntries')}
            </div>
          ) : (
            items.map((item) => (
              <SortableItem key={item.id} item={item} containerId={id} onEdit={onEdit} />
            ))
          )}
          {/* Extra dummy element to always provide a drop target */}
          <div id="dummy-drop-zone" className="h-8" />
        </div>
      </SortableContext>
    </div>
  );
}
