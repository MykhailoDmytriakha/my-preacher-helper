"use client";

import React from "react";

import { UI_COLORS } from "@/utils/themeColors";

interface FocusSidebarProps {
  visible: boolean;
  style?: React.CSSProperties;
  header: React.ReactNode;
  actions: React.ReactNode;
  points: React.ReactNode;
}

const FocusSidebar: React.FC<FocusSidebarProps> = ({ visible, style, header, actions, points }) => (
  <div
    className={`${visible ? 'block' : 'hidden'} md:block md:w-64 md:flex-shrink lg:w-72 lg:flex-shrink-0 sticky top-16 self-start max-h-[calc(100vh-4rem)] z-40`}
  >
    <div
      className={`h-full rounded-lg shadow-lg flex flex-col ${UI_COLORS.neutral.bg} dark:${UI_COLORS.neutral.darkBg} border ${UI_COLORS.neutral.border} dark:${UI_COLORS.neutral.darkBorder}`}
      style={style}
    >
      <div className="p-5 border-b border-white dark:border-gray-600">
        {header}
      </div>
      <div className="p-5 border-b border-white dark:border-gray-600">
        {actions}
      </div>
      {points}
    </div>
  </div>
);

export default FocusSidebar;
