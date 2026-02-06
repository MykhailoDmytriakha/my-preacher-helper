import { createHash } from "crypto";

export type PromptBlockSource = "system" | "user";

export type PromptBlockCategory =
  | "role"
  | "task"
  | "language"
  | "format"
  | "constraints"
  | "context"
  | "examples"
  | "policy"
  | "style"
  | "schema"
  | "safety"
  | "other";

export interface PromptBlockSpec {
  blockId: string;
  category: PromptBlockCategory;
  content: string;
  blockVersion?: string;
}

export interface PromptBlock extends PromptBlockSpec {
  source: PromptBlockSource;
  contentHash: string;
  contentLength: number;
}

export interface PromptBlueprint {
  promptName: string;
  promptVersion: string;
  expectedLanguage: string | null;
  context: Record<string, unknown> | null;
  systemPrompt: string;
  userMessage: string;
  blocks: PromptBlock[];
}

export interface BuildPromptBlueprintInput {
  promptName: string;
  promptVersion?: string;
  expectedLanguage?: string | null;
  context?: Record<string, unknown>;
  systemBlocks: PromptBlockSpec[];
  userBlocks: PromptBlockSpec[];
}

export interface BuildSimplePromptBlueprintInput {
  promptName: string;
  promptVersion?: string;
  expectedLanguage?: string | null;
  context?: Record<string, unknown>;
  systemPrompt: string;
  userMessage: string;
  systemBlockId?: string;
  userBlockId?: string;
  systemCategory?: PromptBlockCategory;
  userCategory?: PromptBlockCategory;
}

const DEFAULT_PROMPT_VERSION = "v1";

function toSha256(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

function normalizeContent(content: string): string {
  return content.replace(/\r\n/g, "\n").trim();
}

function buildBlock(source: PromptBlockSource, spec: PromptBlockSpec): PromptBlock {
  const normalizedContent = normalizeContent(spec.content);
  return {
    ...spec,
    source,
    content: normalizedContent,
    contentHash: toSha256(normalizedContent),
    contentLength: normalizedContent.length,
  };
}

function joinBlocks(blocks: PromptBlock[]): string {
  return blocks
    .map((block) => block.content)
    .filter((content) => content.length > 0)
    .join("\n\n")
    .trim();
}

export function buildPromptBlueprint(input: BuildPromptBlueprintInput): PromptBlueprint {
  const systemBlocks = input.systemBlocks.map((block) => buildBlock("system", block));
  const userBlocks = input.userBlocks.map((block) => buildBlock("user", block));
  const blocks = [...systemBlocks, ...userBlocks];

  return {
    promptName: input.promptName,
    promptVersion: input.promptVersion || DEFAULT_PROMPT_VERSION,
    expectedLanguage: input.expectedLanguage ?? null,
    context: input.context || null,
    systemPrompt: joinBlocks(systemBlocks),
    userMessage: joinBlocks(userBlocks),
    blocks,
  };
}

export function buildSimplePromptBlueprint(input: BuildSimplePromptBlueprintInput): PromptBlueprint {
  return buildPromptBlueprint({
    promptName: input.promptName,
    promptVersion: input.promptVersion,
    expectedLanguage: input.expectedLanguage,
    context: input.context,
    systemBlocks: [
      {
        blockId: input.systemBlockId || `${input.promptName}.system.base`,
        category: input.systemCategory || "task",
        content: input.systemPrompt,
      },
    ],
    userBlocks: [
      {
        blockId: input.userBlockId || `${input.promptName}.user.base`,
        category: input.userCategory || "context",
        content: input.userMessage,
      },
    ],
  });
}

export function detectDominantLanguage(text: string): string {
  if (!text.trim()) return "unknown";

  const hasUkrainianChars = /[їієґЇІЄҐ]/.test(text);
  const hasRussianChars = /[ыэъЫЭЪ]/.test(text);
  const hasCyrillic = /[\u0400-\u04FF]/.test(text);
  const hasLatin = /[A-Za-z]/.test(text);

  if (hasUkrainianChars) return "uk";
  if (hasRussianChars) return "ru";
  if (hasCyrillic) return "cyrillic";
  if (hasLatin) return "en";
  return "unknown";
}

