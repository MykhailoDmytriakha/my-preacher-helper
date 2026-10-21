import type { StructureWriter } from '@/components/sermon/structureWriter';
import type { SermonOutline } from '@/models/models';

/** Per-screen input ancestry, not a stored draft or evidence of durable capture. */
export interface OutlineInputSequence {
  apply<T>(base: SermonOutline | null, input: SermonOutline, edit: (base: SermonOutline | null) => T): T;
}

interface OutlineHandlers {
  stored: (stored: SermonOutline) => void;
  failed: (error: unknown, mine: SermonOutline, base: SermonOutline | null) => void;
}
interface OutlineInput {
  outline: SermonOutline;
  base: SermonOutline | null;
  begin: () => OutlineHandlers;
}

/** Hand each accepted input to the engine now; the engine owns persistence and delivery. */
export class OutlineCapture {
  private latest: OutlineInput | null = null;
  private readonly pending = new Set<Promise<void>>();
  private readonly sequence: OutlineInputSequence;

  constructor(private readonly writer: Pick<StructureWriter, 'updateSermonOutline'>,
    private readonly id: string, private readonly collision?: 'refuse' | 'preferMine') {
    let previous: { base: SermonOutline | null; input: SermonOutline } | undefined;
    this.sequence = { apply: (base, input, edit) => {
      // Until the screen adopts a returned base, its next edit continues its own last input.
      // Advance only when the canonical updater accepted the merge, never on a refusal.
      const result = edit(previous && previous.base === base ? previous.input : base);
      previous = { base, input };
      return result;
    } };
  }

  schedule(input: OutlineInput): void {
    this.latest = input;
    const handlers = input.begin();
    let writing: Promise<SermonOutline | null>;
    try {
      writing = this.writer.updateSermonOutline(this.id, input.outline, input.base, this.collision, this.sequence);
    } catch (error) { writing = Promise.reject(error); }
    const settled = writing.then(stored => {
      if (this.latest === input) handlers.stored(stored ?? input.outline);
    }, error => {
      if (this.latest === input) handlers.failed(error, input.outline, input.base);
    });
    this.pending.add(settled);
    void settled.then(() => this.pending.delete(settled), () => this.pending.delete(settled));
  }

  /** Wait for already-started attempts; settlement alone does not mean that they saved. */
  async flush(): Promise<void> { await Promise.allSettled([...this.pending]); }
}
