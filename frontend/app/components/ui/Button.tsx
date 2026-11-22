"use client";

import React from "react";

type ButtonVariant = "default" | "primary" | "secondary" | "section" | "plan" | "structure";

interface ButtonProps {
  onClick?: () => unknown;
  variant?: ButtonVariant;
  sectionColor?: { base: string; light: string; dark: string };
  className?: string;
  disabled?: boolean;
  children: React.ReactNode;
  title?: string;
}

/**
 * ONE BUTTON FOR THE PLAN SCREENS.
 *
 * The plan page and the thoughts layout each kept their own copy of this button, and this shared
 * one had drifted: its base classes carried `text-white`, which beat the default variant's grey
 * text in Tailwind's CSS order, so a default button read white-on-light-grey — "Refine request"
 * looked switched off (owner, 2026-11-21). The copies were right; this is now the one they share,
 * and every variant names its own text colour.
 */
// White labels keep their contrast in the dark theme too: the lighter dark-mode fills and
// hovers dropped them to about 2.5:1 (Codex review, 2026-11-21), so filled variants stay put.
const VARIANT_CLASSES: Record<Exclude<ButtonVariant, "section">, string> = {
  default: "bg-gray-200 text-gray-800 hover:bg-gray-300 dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-600",
  primary: "bg-blue-600 text-white hover:bg-blue-700",
  secondary: "bg-gray-600 text-white hover:bg-gray-700",
  plan: "bg-blue-600 text-white hover:bg-blue-700",
  structure: "bg-amber-600 text-white hover:bg-amber-700",
};

export const Button = ({
  onClick,
  variant = "default",
  sectionColor,
  className,
  disabled,
  children,
  title,
}: ButtonProps) => {
  const baseClasses = "px-4 py-2 text-sm font-medium rounded-md transition-colors";
  const sectioned = variant === "section" && sectionColor;
  const variantClass = sectioned
    ? "text-white section-button"
    : VARIANT_CLASSES[variant === "section" ? "default" : variant];

  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`${baseClasses} ${variantClass} ${disabled ? "opacity-50 cursor-not-allowed" : ""} ${className || ""}`}
      style={sectioned
        ? ({
          backgroundColor: sectionColor.light,
          "--hover-bg": sectionColor.dark,
          "--active-bg": sectionColor.base,
          borderColor: sectionColor.dark,
        } as React.CSSProperties)
        : undefined}
      title={title}
    >
      {children}
    </button>
  );
};

export default Button;
