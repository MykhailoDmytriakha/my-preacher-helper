import type { Sermon, Thought } from "@/models/models";
import { i18n } from '@locales/i18n';

export function exportSermonContent(sermon: Sermon): Promise<string> {
  const header = `${i18n.t('export.sermonTitle')}${sermon.title}\n${
    sermon.verse ? i18n.t('export.scriptureText') + sermon.verse + "\n" : ""
  }\n`;

  const structure = sermon.structure;

  console.log('[Structure Export] Sermon:', sermon);

  if (structure && !Array.isArray(structure) && Object.keys(structure).length > 0) {
    console.log('[Structure Export] Using persisted structure order');
    
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

    console.log('[Structure Export] Raw structure:', JSON.stringify(structure, null, 2));

    // Define the desired order of sections
    const sectionOrder = ['introduction', 'main', 'conclusion', 'ambiguous'];
    
    // Process structured sections in the specified order
    sectionOrder.forEach((sectionKey: string) => {
      const thoughtIds = structure[sectionKey];
      console.log(`[Structure Export] Processing section ${sectionKey} with ${thoughtIds?.length || 0} thoughts`);
      
      if (thoughtIds && Array.isArray(thoughtIds) && thoughtIds.length > 0) {
        const sectionThoughts = thoughtIds
          .map((id: string) => thoughtMap[id])
          .filter(t => t !== undefined);

        console.log(`[Structure Export] Section ${sectionKey} ordered thoughts:`, 
          sectionThoughts.map(t => `${t.id} (${new Date(t.date).toISOString()})`));
        
        const { header: sectionHeader, includeTags } = sectionMapping[sectionKey] || { header: sectionKey, includeTags: true };
        if (sectionThoughts.length > 0) {
          content += formatSection(sectionHeader, sectionThoughts, includeTags) + "\n\n";
        }
      }
    });

    // Include thoughts not assigned to any structured section
    const structuredThoughtIds = new Set(sectionOrder.flatMap(key => structure[key] || []));
    const otherThoughts = sermon.thoughts
      .filter(t => !structuredThoughtIds.has(t.id))
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    if (otherThoughts.length > 0) {
      content += formatSection(i18n.t('export.otherThoughts'), otherThoughts, true) + "\n\n";
    }

    return Promise.resolve(content);
  } else {
    // Date-based sorting remains unchanged for this fix
    console.log('[Date Sorting] No structure found, using date-based sorting');
    const thoughts: Thought[] = [...sermon.thoughts].sort((a, b) => {
      const dateA = new Date(a.date).getTime();
      const dateB = new Date(b.date).getTime();
      console.log(`[Date Sorting] Comparing ${a.id} (${a.date}) vs ${b.id} (${b.date}) => ${dateA - dateB}`);
      return dateA - dateB;
    });

    console.log('[Date Sorting] Final sorted order:',
      thoughts.map(t => `${t.id} (${t.date})`));

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
        const modifiedText = extraTags.length > 0 ? `${thought.text}\nТеги: ${extraTags.join(", ")}` : thought.text;
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
        .map((t: Thought) => includeTags ? `- ${t.text}\n${i18n.t('export.tagsLabel')} ${t.tags.join(", ")}` : `- ${t.text}`)
        .join("\n");
      return `${title}:\n${formattedThoughts}`;
    };

    let content = header;
    if (introSection.length > 0) content += formatSection(i18n.t('tags.introduction'), introSection, false) + "\n\n";
    if (mainSection.length > 0) content += formatSection(i18n.t('tags.mainPart'), mainSection, false) + "\n\n";
    if (conclusionSection.length > 0) content += formatSection(i18n.t('tags.conclusion'), conclusionSection, false) + "\n\n";
    if (multiTagSection.length > 0) content += formatSection(i18n.t('export.multiTagThoughts'), multiTagSection, true) + "\n\n";
    if (otherSection.length > 0) content += formatSection(i18n.t('export.otherThoughts'), otherSection, true) + "\n\n";

    console.log('[Date Sorting] Group counts:', {
      intro: introSection.length,
      main: mainSection.length,
      conclusion: conclusionSection.length,
      multiTag: multiTagSection.length,
      other: otherSection.length
    });

    return Promise.resolve(content);
  }
}