import { useCallback, useState, useSyncExternalStore } from 'react';

import { isMarkColor, isPencilColor, type MarkColor, type PencilColor, type StrokeKind } from '@/utils/bibleMarks';

/*
 * THE TOOL IN HAND — three round buttons in the reader's line (the owner's design, 2026-10-16): the
 * marker with its five colours, the pencil with grey and the same five, the eraser. A button taken is
 * the tool in hand; taken again it is put away. The marker and the pencil open their colours when
 * taken; a colour picked, or a stroke begun, closes them; pressed while their colours are out, they
 * only close them. The device remembers each tool's colour and the last tool: an Apple Pencil paints
 * with them at once, with nothing taken (`beginStroke`).
 */
export type MarkToolName = 'marker' | 'pencil' | 'eraser';
type ColoredTool = 'marker' | 'pencil';

type ToolPrefs = { color: MarkColor; pencilColor: PencilColor; last: MarkToolName };

const DEFAULT_PREFS: ToolPrefs = { color: 'orange', pencilColor: 'gray', last: 'marker' };
const STORAGE_KEY = 'bible:mark-tool';
const TOOLS: readonly MarkToolName[] = ['marker', 'pencil', 'eraser'];

let memory: ToolPrefs | null = null;
let snapshot: { raw: string | null; prefs: ToolPrefs } | null = null;
const listeners = new Set<() => void>();

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

function readPrefs(): ToolPrefs {
  if (memory) return memory;
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(STORAGE_KEY);
  } catch {
    raw = null;
  }
  if (!snapshot || snapshot.raw !== raw) snapshot = { raw, prefs: parse(raw) };
  return snapshot.prefs;
}

function savePrefs(change: Partial<ToolPrefs>): void {
  const next = { ...readPrefs(), ...change };
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    memory = null;
  } catch {
    memory = next;
  }
  listeners.forEach((listener) => listener());
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

function strokeOf(tool: MarkToolName, prefs: ToolPrefs): StrokeKind {
  if (tool === 'marker') return { tool: 'marker', color: prefs.color };
  if (tool === 'pencil') return { tool: 'pencil', color: prefs.pencilColor };
  return { tool: 'eraser' };
}

export type MarkToolState = {
  inHand: MarkToolName | null;
  color: MarkColor;
  pencilColor: PencilColor;
  /** Whose colours are out, if any. */
  palette: ColoredTool | null;
  /** The marker's or the pencil's button: take it (its colours open), close its colours, or put it away. */
  pressColored: (tool: ColoredTool) => void;
  /** The eraser's button: take it or put it away. */
  pressEraser: () => void;
  pickColor: (color: MarkColor) => void;
  pickPencilColor: (color: PencilColor) => void;
  closePalette: () => void;
  /** A stroke is starting: what it paints with — the tool in hand, or, for a pen, the last one (taken). */
  beginStroke: (pen: boolean) => StrokeKind | null;
};

export function useMarkTool(): MarkToolState {
  const prefs = useSyncExternalStore(subscribe, readPrefs, () => DEFAULT_PREFS);
  const [inHand, setInHand] = useState<MarkToolName | null>(null);
  const [palette, setPalette] = useState<ColoredTool | null>(null);

  const pressColored = useCallback((tool: ColoredTool) => {
    if (inHand !== tool) {
      setInHand(tool);
      setPalette(tool);
      savePrefs({ last: tool });
    } else if (palette === tool) {
      setPalette(null);
    } else {
      setInHand(null);
    }
  }, [inHand, palette]);

  const pressEraser = useCallback(() => {
    setPalette(null);
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
    setPalette(null);
  }, []);

  const pickPencilColor = useCallback((pencilColor: PencilColor) => {
    savePrefs({ pencilColor, last: 'pencil' });
    setInHand('pencil');
    setPalette(null);
  }, []);

  const closePalette = useCallback(() => setPalette(null), []);

  const beginStroke = useCallback((pen: boolean): StrokeKind | null => {
    setPalette(null);
    const tool = inHand ?? (pen ? prefs.last : null);
    if (!tool) return null;
    if (!inHand) setInHand(tool);
    return strokeOf(tool, prefs);
  }, [inHand, prefs]);

  return {
    inHand,
    color: prefs.color,
    pencilColor: prefs.pencilColor,
    palette,
    pressColored,
    pressEraser,
    pickColor,
    pickPencilColor,
    closePalette,
    beginStroke,
  };
}
