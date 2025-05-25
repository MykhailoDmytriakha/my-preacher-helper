"use client";

import React from "react";

interface ButtonProps {
  onClick?: () => void;
  variant?: "default" | "primary" | "secondary" | "section";
  sectionColor?: { base: string; light: string; dark: string };
  className?: string;
  disabled?: boolean;
  children: React.ReactNode;
  title?: string;
}

export const Button = ({
  onClick,
  variant = "default",
  sectionColor,
  className,
  disabled,
  children,
  title,
}: ButtonProps) => {
  let buttonClasses = "";

  // Base styles
  const baseStyles = "px-4 py-2 text-sm font-medium rounded-md transition-colors text-white";

  switch (variant) {
    case "primary":
      buttonClasses = `${baseStyles} bg-blue-500 hover:bg-blue-600 text-white`;
      break;
    case "secondary":
      buttonClasses = `${baseStyles} bg-gray-500 hover:bg-gray-600 text-white`;
      break;
    case "section":
      if (sectionColor) {
        buttonClasses = `${baseStyles} section-button`;
        const hoverBg = sectionColor.dark;
        const activeBg = sectionColor.base;
        const style = {
          backgroundColor: sectionColor.base,
          "--hover-bg": hoverBg,
          "--active-bg": activeBg,
          borderColor: sectionColor.dark,
        } as React.CSSProperties;
        
        return (
          <button
            onClick={onClick}
            className={`${buttonClasses} ${className || ""}`}
            disabled={disabled}
            title={title}
            style={style}
          >
            {children}
          </button>
        );
      } else {
        buttonClasses = `${baseStyles} bg-blue-500 hover:bg-blue-600 text-white`;
      }
      break;
    default:
      buttonClasses = `${baseStyles} bg-gray-200 hover:bg-gray-300 text-gray-700 dark:bg-gray-600 dark:hover:bg-gray-500 dark:text-white`;
      break;
  }

  return (
    <button
      onClick={onClick}
      className={`${buttonClasses} ${className || ""}`}
      disabled={disabled}
      title={title}
    >
      {children}
    </button>
  );
}; 