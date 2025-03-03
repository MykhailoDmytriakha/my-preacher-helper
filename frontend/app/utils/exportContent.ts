import type { Sermon, Structure, Thought } from "@/models/models";
import { i18n } from '@locales/i18n';

// Debug flag - can be turned on/off as needed, or controlled via environment variable
const DEBUG_EXPORT = false;

// Centralized debug logger
const debugLog = (message: string, data?: any) => {
  if (DEBUG_EXPORT) {
    if (data) {
      console.log(`[Export] ${message}`, data);
    } else {
      console.log(`[Export] ${message}`);
    }
  }
};

export function exportSermonContent(sermon: Sermon): Promise<string> {
  if (sermon.title.trim() === '' || sermon.verse.trim() === '') {
    return Promise.resolve('');
  }
  const header = `${i18n.t('export.sermonTitle')}${sermon.title}\n${
    sermon.verse ? `${i18n.t('export.scriptureText')}\n${sermon.verse}` + "\n" : ""
  }\n`;

  const structure = sermon.structure;

  debugLog("Starting sermon export", { id: sermon.id, title: sermon.title });

  if (structure && !Array.isArray(structure) && Object.keys(structure).length > 0) {
    debugLog("Using persisted structure order");
    
    // Build a map of thought IDs to thoughts, applying text modifications if applicable
    const requiredTags = ["Вступление", "Основная часть", "Заключение"];
    const thoughtMap: Record<string, Thought> = {};
    sermon.thoughts.forEach((thought: Thought) => {
      const requiredMatches = thought.tags.filter(tag => requiredTags.includes(tag));
      if (requiredMatches.length === 1) {
        const extraTags = thought.tags.filter(tag => !requiredTags.includes(tag));
        const modifiedText = extraTags.length > 0 ? `${thought.text}\n  ${i18n.t('export.tagsLabel')}${extraTags.join(", ")}` : thought.text;
        thoughtMap[thought.id] = { ...thought, text: modifiedText };
      } else {
        thoughtMap[thought.id] = thought;
      }
    });

    const formatSection = (title: string, thoughts: Thought[], includeTags: boolean = true): string => {
      if (!thoughts.length) return "";
      const formattedThoughts = thoughts
        .map((t: Thought) => includeTags ? `- ${t.text}${t.tags.length > 0 ? `\n  ${i18n.t('export.tagsLabel')}${t.tags.join(", ")}` : ''}` : `- ${t.text}`)
        .join("\n");
      return `${title}:\n${formattedThoughts}`;
    };

    let content = header;
    const sectionMapping: Record<string, { header: string, includeTags: boolean }> = {
      introduction: { header: i18n.t('tags.introduction'), includeTags: false },
      main: { header: i18n.t('tags.mainPart'), includeTags: false },
      conclusion: { header: i18n.t('tags.conclusion'), includeTags: false },
      ambiguous: { header: i18n.t('export.otherThoughts'), includeTags: true }
    };

    debugLog("Structure format", { structureKeys: Object.keys(structure) });

    // Define the desired order of sections
    const sectionOrder: (keyof Structure)[] = ['introduction', 'main', 'conclusion', 'ambiguous'];
    
    // Process structured sections in the specified order
    sectionOrder.forEach((sectionKey: keyof Structure) => {
      const thoughtIds = structure[sectionKey];
      debugLog(`Processing section ${sectionKey}`, { count: thoughtIds?.length || 0 });
      
      if (thoughtIds && Array.isArray(thoughtIds) && thoughtIds.length > 0) {
        const sectionThoughts = thoughtIds
          .map((id: string) => thoughtMap[id])
          .filter(t => t !== undefined);
        
        const { header: sectionHeader, includeTags } = sectionMapping[sectionKey] || { header: sectionKey, includeTags: true };
        if (sectionThoughts.length > 0) {
          content += formatSection(sectionHeader, sectionThoughts, includeTags) + "\n\n" + "----------------------------------" + "\n\n";
        }
      }
    });

    // Include thoughts not assigned to any structured section
    const structuredThoughtIds = new Set(sectionOrder.flatMap(key => structure[key] || []));
    const otherThoughts = sermon.thoughts
      .filter(t => !structuredThoughtIds.has(t.id))
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    
    debugLog("Unstructured thoughts", { count: otherThoughts.length });
    
    if (otherThoughts.length > 0) {
      content += formatSection(i18n.t('export.otherThoughts'), otherThoughts, true) + "\n\n" + "----------------------------------" + "\n\n";
    }

    return Promise.resolve(content);
  } else {
    // Date-based sorting remains unchanged for this fix
    debugLog("No structure found, using date-based sorting");
    const thoughts: Thought[] = [...sermon.thoughts].sort((a, b) => {
      const dateA = new Date(a.date).getTime();
      const dateB = new Date(b.date).getTime();
      return dateA - dateB;
    });

    debugLog("Sorted thoughts by date", { count: thoughts.length });

    const introSection: Thought[] = [];
    const mainSection: Thought[] = [];
    const conclusionSection: Thought[] = [];
    const multiTagSection: Thought[] = [];
    const otherSection: Thought[] = [];
    const requiredTags = ["Вступление", "Основная часть", "Заключение"];

    thoughts.forEach((thought: Thought) => {
      const requiredMatches = thought.tags.filter(tag => requiredTags.includes(tag));

      if (requiredMatches.length === 1) {
        const extraTags = thought.tags.filter(tag => !requiredTags.includes(tag));
        const modifiedText = extraTags.length > 0 ? `${thought.text}\n${i18n.t('export.tagsLabel')}${extraTags.join(", ")}` : thought.text;
        const modifiedThought = { ...thought, text: modifiedText };

        if (requiredMatches[0] === "Вступление") {
          introSection.push(modifiedThought);
        } else if (requiredMatches[0] === "Основная часть") {
          mainSection.push(modifiedThought);
        } else if (requiredMatches[0] === "Заключение") {
          conclusionSection.push(modifiedThought);
        } else {
          otherSection.push(thought);
        }
      } else if (thought.tags.length >= 2) {
        multiTagSection.push(thought);
      } else if (thought.tags.length === 1) {
        otherSection.push(thought);
      } else {
        otherSection.push(thought);
      }
    });

    const formatSection = (title: string, thoughts: Thought[], includeTags: boolean = true): string => {
      if (!thoughts.length) return "";
      const formattedThoughts = thoughts
        .map((t: Thought) => includeTags ? `- ${t.text}\n${i18n.t('export.tagsLabel')}${t.tags.join(", ")}` : `- ${t.text}`)
        .join("\n");
      return `${title}:\n${formattedThoughts}`;
    };

    let content = header;
    if (introSection.length > 0) content += formatSection(i18n.t('tags.introduction'), introSection, false) + "\n\n" + "----------------------------------" + "\n\n";
    if (mainSection.length > 0) content += formatSection(i18n.t('tags.mainPart'), mainSection, false) + "\n\n" + "----------------------------------" + "\n\n";
    if (conclusionSection.length > 0) content += formatSection(i18n.t('tags.conclusion'), conclusionSection, false) + "\n\n" + "----------------------------------" + "\n\n";
    if (multiTagSection.length > 0) content += formatSection(i18n.t('export.multiTagThoughts'), multiTagSection, true) + "\n\n" + "----------------------------------" + "\n\n";
    if (otherSection.length > 0) content += formatSection(i18n.t('export.otherThoughts'), otherSection, true) + "\n\n" + "----------------------------------" + "\n\n";

    debugLog("Section counts", {
      intro: introSection.length,
      main: mainSection.length,
      conclusion: conclusionSection.length,
      multiTag: multiTagSection.length,
      other: otherSection.length
    });

    return Promise.resolve(content);
  }
}