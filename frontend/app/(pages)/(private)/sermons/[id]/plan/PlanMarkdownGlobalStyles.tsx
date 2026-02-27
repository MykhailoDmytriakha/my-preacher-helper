import { SERMON_SECTION_COLORS } from "@/utils/themeColors";

import { sectionButtonStyles } from "./constants";

type PlanMarkdownGlobalStylesVariant = "main" | "immersive" | "preaching";

const MAIN_LAYOUT_STYLES = `
  /* Prevent scroll anchoring in dynamic plan columns */
  [data-testid="plan-introduction-left-section"],
  [data-testid="plan-introduction-right-section"],
  [data-testid="plan-main-left-section"],
  [data-testid="plan-main-right-section"],
  [data-testid="plan-conclusion-left-section"],
  [data-testid="plan-conclusion-right-section"] {
    overflow-anchor: none;
  }

  /* Indentation for hierarchical structure */
  .markdown-content h2 {
    margin-left: 0;
  }
  .markdown-content h3 {
    margin-left: 1.5rem;
  }
  .markdown-content h4, .markdown-content h5, .markdown-content h6 {
    margin-left: 3rem;
  }
  /* Indent paragraphs and lists to align with their headings */
  .markdown-content h2 + p, .markdown-content h2 + ul, .markdown-content h2 + ol {
    margin-left: 1.5rem;
  }
  .markdown-content h3 + p, .markdown-content h3 + ul, .markdown-content h3 + ol {
    margin-left: 3rem;
  }
  .markdown-content h4 + p, .markdown-content h4 + ul, .markdown-content h4 + ol,
  .markdown-content h5 + p, .markdown-content h5 + ul, .markdown-content h5 + ol,
  .markdown-content h6 + p, .markdown-content h6 + ul, .markdown-content h6 + ol {
    margin-left: 4.5rem;
  }
  /* Continuing indentation for paragraphs without headings */
  .markdown-content p + p, .markdown-content ul + p, .markdown-content ol + p {
    margin-left: inherit;
  }
  .markdown-content ul,
  .markdown-content ol {
    margin-top: 0.5em;
    margin-bottom: 0.5em;
    padding-left: 1.5em;
  }
  .markdown-content li {
    margin-top: 0.25em;
    margin-bottom: 0.25em;
  }
  .markdown-content li > p {
    margin-top: 0;
    margin-bottom: 0;
  }
  /* Remove borders from all elements */
  .markdown-content * {
    border: none !important;
  }
  /* Fix for first paragraph layout issue */
  .markdown-content > p:first-child {
    margin-top: 0;
    display: inline-block;
  }
  /* Ensure first element doesn't create unwanted space */
  .markdown-content > *:first-child {
    margin-top: 0;
  }
`;

const MARKDOWN_COMMON_STYLES = `
  /* Markdown content styling */
  .markdown-content {
    line-height: 1.5;
  }
  .markdown-content p {
    margin-top: 0.5em;
    margin-bottom: 0.5em;
  }
  .markdown-content h1,
  .markdown-content h2,
  .markdown-content h3,
  .markdown-content h4,
  .markdown-content h5,
  .markdown-content h6 {
    margin-top: 1em;
    margin-bottom: 0.5em;
  }

  /* Visual markers for different heading levels */
  .markdown-content h2::before {
    content: "";
    display: inline-block;
    width: 6px;
    height: 20px;
    background-color: ${SERMON_SECTION_COLORS.introduction.base};
    margin-right: 10px;
    border-radius: 2px;
    vertical-align: text-top;
  }

  /* Use section context to style bullets */
  /* Introduction bullets (h3) */
  .markdown-content.prose-introduction h3::before,
  .markdown-content.introduction-section h3::before {
    content: "•";
    display: inline-block;
    margin-right: 8px;
    color: ${SERMON_SECTION_COLORS.introduction.light};
    font-weight: bold;
  }

  /* Main section bullets (h3) */
  .markdown-content.prose-main h3::before,
  .markdown-content.main-section h3::before {
    content: "•";
    display: inline-block;
    margin-right: 8px;
    color: ${SERMON_SECTION_COLORS.mainPart.light};
    font-weight: bold;
  }

  /* Conclusion bullets (h3) */
  .markdown-content.prose-conclusion h3::before,
  .markdown-content.conclusion-section h3::before {
    content: "•";
    display: inline-block;
    margin-right: 8px;
    color: ${SERMON_SECTION_COLORS.conclusion.light};
    font-weight: bold;
  }

  /* Default h3 bullets - only apply when no section class is present */
  .markdown-content h3:not(.markdown-content.prose-introduction h3):not(.markdown-content.prose-main h3):not(.markdown-content.prose-conclusion h3):not(.markdown-content.introduction-section h3):not(.markdown-content.main-section h3):not(.markdown-content.conclusion-section h3)::before {
    content: "•";
    display: inline-block;
    margin-right: 8px;
    color: ${SERMON_SECTION_COLORS.mainPart.base};
    font-weight: bold;
  }

  /* Default h4 circles */
  .markdown-content h4::before {
    content: "○";
    display: inline-block;
    margin-right: 8px;
    color: ${SERMON_SECTION_COLORS.conclusion.base};
    font-weight: bold;
  }

  /* Section-specific styles for introduction section */
  .markdown-content.prose-introduction h2::before {
    background-color: ${SERMON_SECTION_COLORS.introduction.base};
  }
  .markdown-content.prose-introduction h4::before {
    color: ${SERMON_SECTION_COLORS.introduction.dark};
  }

  /* Section-specific styles for main section */
  .markdown-content.prose-main h2::before {
    background-color: ${SERMON_SECTION_COLORS.mainPart.base};
  }
  .markdown-content.prose-main h4::before {
    color: ${SERMON_SECTION_COLORS.mainPart.dark};
  }

  /* Section-specific styles for conclusion section */
  .markdown-content.prose-conclusion h2::before {
    background-color: ${SERMON_SECTION_COLORS.conclusion.base};
  }
  .markdown-content.prose-conclusion h4::before {
    color: ${SERMON_SECTION_COLORS.conclusion.dark};
  }

  /* Dark mode colors */
  @media (prefers-color-scheme: dark) {
    .markdown-content h2::before {
      background-color: ${SERMON_SECTION_COLORS.introduction.light};
    }
    .markdown-content h3:not(.markdown-content.prose-introduction h3):not(.markdown-content.prose-main h3):not(.markdown-content.prose-conclusion h3):not(.markdown-content.introduction-section h3):not(.markdown-content.main-section h3):not(.markdown-content.conclusion-section h3)::before {
      color: ${SERMON_SECTION_COLORS.mainPart.light};
    }
    .markdown-content h4::before {
      color: ${SERMON_SECTION_COLORS.conclusion.light};
    }
  }
`;

const PREACHING_CONTENT_STYLES = `
  .preaching-content {
    max-width: 4xl;
    margin: 0 auto;
  }
`;

function getVariantStyles(variant: PlanMarkdownGlobalStylesVariant): string {
  if (variant === "main") {
    return MAIN_LAYOUT_STYLES;
  }
  return PREACHING_CONTENT_STYLES;
}

interface PlanMarkdownGlobalStylesProps {
  variant: PlanMarkdownGlobalStylesVariant;
}

export default function PlanMarkdownGlobalStyles({ variant }: PlanMarkdownGlobalStylesProps) {
  return (
    <>
      <style jsx global>{sectionButtonStyles}</style>
      <style jsx global>{`${MARKDOWN_COMMON_STYLES}${getVariantStyles(variant)}`}</style>
    </>
  );
}
