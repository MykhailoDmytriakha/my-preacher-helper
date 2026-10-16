import { heardChunks, storedSource } from '@/utils/audioChunkIdentity';

import type { AudioChunk, AudioSourceMode, PreparedAudioSet, PreparedAudioSources, PreparedAudioVersion, SermonSection } from '@/types/audioGeneration.types';

export interface PreparedAudioFields { audioSources: PreparedAudioSources; audioChunks: AudioChunk[]; audioMetadata: Record<string, unknown> & { mode: AudioSourceMode; chunksCount: number } }
export interface AudioSourceDocument { audioChunks?: unknown; audioMetadata?: unknown; audioSources?: unknown }
const modes: AudioSourceMode[] = ['ai', 'raw'];
const sections: SermonSection[] = ['introduction', 'mainPart', 'conclusion'];
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const valid = (value: unknown): value is PreparedAudioSet => object(value) && typeof value.id === 'string' && value.id.length > 0
  && Number.isSafeInteger(value.revision) && Number(value.revision) >= 0 && Array.isArray(value.chunks) && Array.isArray(value.sections)
  && value.sections.every(section => sections.includes(section as SermonSection));

/** Legacy promotion is read-only until a real write, and claims no unevidenced section. */
export function readPreparedAudioSources(doc: AudioSourceDocument): PreparedAudioSources {
  const result: PreparedAudioSources = {};
  if (object(doc.audioSources)) for (const mode of modes) if (valid(doc.audioSources[mode])) result[mode] = clone(doc.audioSources[mode] as PreparedAudioSet);
  const mode = storedSource(doc);
  if (!result[mode] && Array.isArray(doc.audioChunks) && doc.audioChunks.length) {
    const chunks = clone(doc.audioChunks) as AudioChunk[];
    result[mode] = { id: 'legacy-' + mode, revision: 0, chunks, sections: sections.filter(section => chunks.some(chunk => chunk.sectionId === section)) };
  }
  return result;
}

export const preparedAudioVersion = (source: PreparedAudioSet): PreparedAudioVersion => ({ id: source.id, revision: source.revision });
export function matchesPreparedAudioVersion(source: PreparedAudioSet | undefined, expected: unknown): boolean {
  return object(expected) && Boolean(source && source.id === expected.id && source.revision === expected.revision);
}
export function preparedAudioCovers(source: PreparedAudioSet | undefined, selected: readonly SermonSection[]): boolean {
  return Boolean(source && selected.length && selected.every(section => source.sections.includes(section)));
}

export class PreparedAudioChanged extends Error {
  constructor(readonly mode: AudioSourceMode, readonly sources: PreparedAudioSources) { super('chunks-changed'); this.name = 'PreparedAudioChanged'; }
}

/** One check for editing/preparation/generation; arrival time and a matching index prove nothing. */
export function requirePreparedAudio(doc: AudioSourceDocument, mode: AudioSourceMode, expected?: unknown, words?: unknown): PreparedAudioSet | undefined {
  const sources = readPreparedAudioSources(doc), source = sources[mode];
  if ((expected !== undefined && !matchesPreparedAudioVersion(source, expected))
    || (Array.isArray(words) && heardChunks(source?.chunks) !== heardChunks(words))) throw new PreparedAudioChanged(mode, sources);
  return source;
}

/** Assign the revision only from the latest document supplied by the canonical transaction. */
export function putPreparedAudio(doc: AudioSourceDocument, mode: AudioSourceMode, chunks: AudioChunk[], options: { id: string; sections: readonly SermonSection[] }): PreparedAudioFields {
  const sources = readPreparedAudioSources(doc), previous = sources[mode];
  const source: PreparedAudioSet = { id: options.id, revision: (previous?.revision ?? 0) + 1, sections: sections.filter(section => options.sections.includes(section)), chunks: clone(chunks) };
  sources[mode] = source;
  return { audioSources: sources, audioChunks: clone(chunks), audioMetadata: { ...(object(doc.audioMetadata) ? doc.audioMetadata : {}), mode, chunksCount: chunks.length } };
}

/** Older cache-switch requests activate stored text; they cannot replace an inactive authored set. */
export function activatePreparedAudio(doc: AudioSourceDocument, mode: AudioSourceMode, chunks: AudioChunk[], expectedActive?: unknown): PreparedAudioFields {
  const sources = readPreparedAudioSources(doc), target = sources[mode];
  if (Array.isArray(expectedActive) && heardChunks(doc.audioChunks) !== heardChunks(expectedActive)) throw new PreparedAudioChanged(storedSource(doc), sources);
  if (target && heardChunks(target.chunks) !== heardChunks(chunks)) throw new PreparedAudioChanged(mode, sources);
  if (!target) return putPreparedAudio(doc, mode, chunks, { id: 'legacy-' + mode, sections: sections.filter(section => chunks.some(chunk => chunk.sectionId === section)) });
  return { audioSources: sources, audioChunks: clone(target.chunks), audioMetadata: { ...(object(doc.audioMetadata) ? doc.audioMetadata : {}), mode, chunksCount: target.chunks.length } };
}

/** A response reconciles saved source data without choosing a source or changing a person's settings. */
export function mergePreparedAudioSources(current: PreparedAudioSources, incoming: PreparedAudioSources): PreparedAudioSources {
  const next = { ...current };
  for (const mode of modes) {
    const source = incoming[mode], previous = current[mode];
    if (source && (!previous || source.revision > previous.revision)) next[mode] = clone(source);
  }
  return next;
}

/** Replace only explicitly prepared sections, checking the source and words observed at the start. */
export function replacePreparedAudioSections(
  doc: AudioSourceDocument,
  mode: AudioSourceMode,
  opening: PreparedAudioSet | undefined,
  replacement: { id: string; sections: readonly SermonSection[]; chunks: AudioChunk[] },
): PreparedAudioFields {
  const sources = readPreparedAudioSources(doc), source = sources[mode];
  const selected = new Set<SermonSection>(replacement.sections);
  const words = (chunks: AudioChunk[] = []) => heardChunks(chunks.filter(chunk => selected.has(chunk.sectionId)).map((chunk, index) => ({ ...chunk, index })));
  if ((opening ? source?.id !== opening.id : Boolean(source)) || words(source?.chunks) !== words(opening?.chunks)) {
    throw new PreparedAudioChanged(mode, sources);
  }
  const kept = (source?.chunks ?? []).filter(chunk => !selected.has(chunk.sectionId));
  const chunks = [...kept, ...replacement.chunks]
    .sort((a, b) => sections.indexOf(a.sectionId) - sections.indexOf(b.sectionId))
    .map((chunk, index) => ({ ...chunk, index }));
  return putPreparedAudio(doc, mode, chunks, { id: replacement.id, sections: [...(source?.sections ?? []), ...replacement.sections] });
}

/** A correction index is stable only within one prepared set with the complete same layout. */
export function preparedAudioTargetUnchanged(opening: PreparedAudioSet, current: PreparedAudioSet | undefined, index: number): boolean {
  const layout = (source: PreparedAudioSet) => heardChunks(source.chunks.map(chunk => ({ ...chunk, text: '' })));
  return Boolean(current && current.revision > 0 && current.id === opening.id
    && Number.isSafeInteger(index) && index >= 0 && index < current.chunks.length
    && current.chunks[index].index === index && layout(opening) === layout(current));
}
