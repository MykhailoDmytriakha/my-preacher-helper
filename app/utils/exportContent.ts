import type { Sermon, Thought } from "@/models/models";

export function exportSermonContent(sermon: Sermon): Promise<string> {
  const header = `Проповедь: ${sermon.title}\n${sermon.verse ? "Текст из Библии: " + sermon.verse + "\n" : ""}\n`;
  const sortedThoughts: Thought[] = [...sermon.thoughts].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  const introSection: Thought[] = [];
  const mainSection: Thought[] = [];
  const conclusionSection: Thought[] = [];
  const multiTagSection: Thought[] = [];
  const otherSection: Thought[] = [];

  sortedThoughts.forEach((thought: Thought) => {
    if (thought.tags.length >= 2) {
      multiTagSection.push(thought);
    } else if (thought.tags.length === 1) {
      const tag = thought.tags[0];
      if (tag === "Вступление") {
        introSection.push(thought);
      } else if (tag === "Основная часть") {
        mainSection.push(thought);
      } else if (tag === "Заключение" || tag === "Заключения") {
        conclusionSection.push(thought);
      } else {
        otherSection.push(thought);
      }
    }
  });

  const formatSection = (title: string, thoughts: Thought[], includeTags: boolean = true): string => {
    if (!thoughts.length) return "";
    const formattedThoughts = thoughts
      .map((t: Thought) => includeTags ? `- ${t.text}\nТеги: ${t.tags.join(", ")}` : `- ${t.text}`)
      .join("\n");
    return `${title}:\n${formattedThoughts}`;
  };

  let content = "";
  if (introSection.length > 0) content += formatSection("Вступление", introSection, false) + "\n\n";
  if (mainSection.length > 0) content += formatSection("Основная часть", mainSection, false) + "\n\n";
  if (conclusionSection.length > 0) content += formatSection("Заключение", conclusionSection, false) + "\n\n";
  if (multiTagSection.length > 0) content += formatSection("Мысли с несколькими метками", multiTagSection, true) + "\n\n";
  if (otherSection.length > 0) content += formatSection("Другие мысли", otherSection, true) + "\n\n";

  return Promise.resolve(header + content);
} 