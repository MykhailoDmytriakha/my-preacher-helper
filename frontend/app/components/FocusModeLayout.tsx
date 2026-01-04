"use client";

import React from "react";

interface FocusModeLayoutProps {
  className?: string;
  sidebar: React.ReactNode;
  content: React.ReactNode;
}

const FocusModeLayout: React.FC<FocusModeLayoutProps> = ({ className = "", sidebar, content }) => (
  <div className={`flex h-full gap-6 justify-center w-full ${className}`}>
    {sidebar}
    {content}
  </div>
);

export default FocusModeLayout;
