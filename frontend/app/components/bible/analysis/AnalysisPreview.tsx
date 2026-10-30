'use client';

import { Fragment, useMemo } from 'react';

import { analysisOutline, depthOf, partStarts, type AnalysisState, type RelationColor } from '@/utils/passageAnalysis';
import { ANALYSIS_RELATION_TONES } from '@/utils/themeColors';

import { tieArrows, useGeometry } from './analysisGeometry';
import { ARROW } from './AnalysisParts';
import { analysisState } from './useAnalysisNote';

import type { StudyAnalysis } from '@/models/models';

/** The analysis's lines read from its text, each with its words and the place of its first word in the passage. */
function linesOf(text: string) {
  let at = 0;
  return analysisOutline(text).map((line) => {
    const words = line.text.split(' ').filter(Boolean);
    const start = at;
    at += words.length;
    return { ...line, words, start };
  });
}

/**
 * AN ANALYSIS DRAWN SMALL, in the reader's list of what stands on a verse (the owner, 30.10: «сюда добавь стрелки уровней,
 * а ссылки просто подкрась слова»): a part a line, stepped as in the analysis; a tie's arrow where the indent does not say
 * it, routed as on the analysis screen (`tieArrows`); the two words of a link of meaning in that link's colour, without
 * flags or arrows. The words are the note's text (the analysis written as Markdown), the ties and links its analysis; when
 * the two no longer agree — a text written before a change — the parts are drawn alone, never a tie on the wrong word.
 */
export function AnalysisPreview({ text, analysis }: { text: string; analysis?: StudyAnalysis }) {
  const lines = useMemo(() => linesOf(text), [text]);
  const total = lines.reduce((count, line) => count + line.words.length, 0);
  const state = useMemo((): AnalysisState | null => {
    if (!analysis) return null;
    const read = analysisState(analysis, total);
    const agrees = JSON.stringify(partStarts(read)) === JSON.stringify(lines.map((line) => line.start))
      && lines.every((line) => depthOf(read, line.start) === line.depth);
    return agrees ? read : null;
  }, [analysis, lines, total]);
  const { contentRef, geometry } = useGeometry();
  const arrows = state ? tieArrows(state, geometry) : [];
  const colours = useMemo(() => {
    const map = new Map<number, RelationColor>();
    state?.relations.forEach(({ a, b, color }) => { if (!map.has(a)) map.set(a, color); if (!map.has(b)) map.set(b, color); });
    return map;
  }, [state]);

  return (
    // The left padding is the arrows' margin: the box scrolls, and what stands left of it would be cut off.
    <div ref={contentRef} className="relative pl-4">
      {arrows.map((arrow) => (
        <svg key={arrow.key} aria-hidden="true" width={geometry.width || 1} height={geometry.height || 1} className="pointer-events-none absolute left-0 top-0 overflow-visible">
          <path d={arrow.d} fill="none" stroke={ARROW.plain} strokeWidth={1.4} strokeLinecap="round" />
          <path d={arrow.head} fill="none" stroke={ARROW.plain} strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ))}
      {lines.map((line) => (
        <div key={line.start} data-analysis-line="" className={`py-0.5 ${line.depth ? 'text-gray-600 dark:text-gray-400' : 'text-gray-900 dark:text-gray-100'}`} style={{ paddingLeft: line.depth * 14 }}>
          {line.words.map((word, k) => {
            const index = line.start + k;
            const colour = colours.get(index);
            return (
              <Fragment key={index}>
                <span data-word={index} className={colour ? `font-semibold ${ANALYSIS_RELATION_TONES[colour].text}` : undefined}>
                  {/* The middle of the small letters: where a tie's arrow leaves the line. */}
                  {k === 0 ? <span data-mid={index} aria-hidden="true" className="inline-block h-0 w-0 align-middle" /> : null}
                  {word}
                </span>
                {k < line.words.length - 1 ? ' ' : ''}
              </Fragment>
            );
          })}
        </div>
      ))}
    </div>
  );
}
