import { useCallback, useState } from 'react';

import { isMarkColor, isPencilColor, type MarkColor, type PencilColor, type StrokeKind } from '@/utils/bibleMarks';
import { deviceChoice } from '@/utils/deviceChoice';

/*
 * THE TOOL IN HAND — three round buttons in the reader's line (the owner's design, 2026-10-16): the
 * marker with its five colours, the pencil with grey and the same five, the eraser. A button taken is
 * the tool in hand; taken again it is put away. The marker's and the pencil's colours are out exactly
 * while the tool is in hand (the owner, 2026-10-16: colours that closed after a pick left the marker
 * looking put away, and the next press to change the colour put it away instead): a colour picked
 * stays in hand with its colours out, a stroke leaves them out, and Escape puts the tool away. The
 * device remembers each tool's colour and the last tool: an Apple Pencil paints
 * with them at once, with nothing taken (`beginStroke`) — and takes nothing either: a finger paints only
 * with a tool it took itself, so a finger after the Pencil still scrolls and taps (the owner's iPad,
 * 2026-10-16: the Pencil took the tool, the black ring came and went, and a finger then painted). The
 * Pencil's tool wears a soft ring once a Pencil has drawn here (`penTool`).
 */
export type MarkToolName = 'marker' | 'pencil' | 'eraser';
type ColoredTool = 'marker' | 'pencil';

type ToolPrefs = { color: MarkColor; pencilColor: PencilColor; last: MarkToolName };

const DEFAULT_PREFS: ToolPrefs = { color: 'orange', pencilColor: 'gray', last: 'marker' };
const STORAGE_KEY = 'bible:mark-tool';
const TOOLS: readonly MarkToolName[] = ['marker', 'pencil', 'eraser'];

function parse(raw: string | null): ToolPrefs {
  if (!raw) return DEFAULT_PREFS;
  try {
    const value = JSON.parse(raw) as Partial<ToolPrefs>;
    return {
      color: isMarkColor(value.color) ? value.color : DEFAULT_PREFS.color,
      pencilColor: isPencilColor(value.pencilColor) ? value.pencilColor : DEFAULT_PREFS.pencilColor,
      last: TOOLS.includes(value.last as MarkToolName) ? (value.last as MarkToolName) : DEFAULT_PREFS.last,
    };
  } catch {
    return DEFAULT_PREFS;
  }
}

// Held in memory, storage only written through (`utils/deviceChoice.ts`): a re-read of storage on the
// owner's iPad gave back an old choice.
const prefsChoice = deviceChoice({ key: STORAGE_KEY, parse, fallback: DEFAULT_PREFS });
const savePrefs = (change: Partial<ToolPrefs>) => { prefsChoice.save(change); };

/** Forgets the tool prefs kept in memory — for tests. */
export function resetMarkToolForTests(): void {
  prefsChoice.resetForTests();
}

function strokeOf(tool: MarkToolName, prefs: ToolPrefs): StrokeKind {
  if (tool === 'marker') return { tool: 'marker', color: prefs.color };
  if (tool === 'pencil') return { tool: 'pencil', color: prefs.pencilColor };
  return { tool: 'eraser' };
}

export type MarkToolState = {
  inHand: MarkToolName | null;
  color: MarkColor;
  pencilColor: PencilColor;
  /** Whose colours are out: the marker's or the pencil's while it is in hand. */
  palette: ColoredTool | null;
  /** Nothing in hand and a Pencil has drawn here: the tool it paints with, shown with a soft ring. */
  penTool: MarkToolName | null;
  /** The marker's or the pencil's button: take it (its colours open with it), or put it away. */
  pressColored: (tool: ColoredTool) => void;
  /** The eraser's button: take it or put it away. */
  pressEraser: () => void;
  pickColor: (color: MarkColor) => void;
  pickPencilColor: (color: PencilColor) => void;
  /** Escape: the tool in hand is put away, its colours with it. */
  putAway: () => void;
  /** A stroke is starting: what it paints with — the tool in hand, or, for a pen, the last one (taken). */
  beginStroke: (pen: boolean) => StrokeKind | null;
};

export function useMarkTool(): MarkToolState {
  const prefs = prefsChoice.useChoice();
  const [inHand, setInHand] = useState<MarkToolName | null>(null);
  const [penSeen, setPenSeen] = useState(false);

  const pressColored = useCallback((tool: ColoredTool) => {
    if (inHand === tool) {
      setInHand(null);
      return;
    }
    setInHand(tool);
    savePrefs({ last: tool });
  }, [inHand]);

  const pressEraser = useCallback(() => {
    if (inHand === 'eraser') {
      setInHand(null);
      return;
    }
    setInHand('eraser');
    savePrefs({ last: 'eraser' });
  }, [inHand]);

  const pickColor = useCallback((color: MarkColor) => {
    savePrefs({ color, last: 'marker' });
    setInHand('marker');
  }, []);

  const pickPencilColor = useCallback((pencilColor: PencilColor) => {
    savePrefs({ pencilColor, last: 'pencil' });
    setInHand('pencil');
  }, []);

  const putAway = useCallback(() => setInHand(null), []);

  const beginStroke = useCallback((pen: boolean): StrokeKind | null => {
    if (pen) setPenSeen(true);
    const tool = inHand ?? (pen ? prefs.last : null);
    return tool ? strokeOf(tool, prefs) : null;
  }, [inHand, prefs]);

  return {
    inHand,
    color: prefs.color,
    pencilColor: prefs.pencilColor,
    palette: inHand === 'marker' || inHand === 'pencil' ? inHand : null,
    penTool: penSeen && !inHand ? prefs.last : null,
    pressColored,
    pressEraser,
    pickColor,
    pickPencilColor,
    putAway,
    beginStroke,
  };
}
