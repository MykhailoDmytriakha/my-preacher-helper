import { isOutlineCollisionError, OutlineCollisionError } from '@/services/sermons.client';
import { DebouncedDocWriter } from '@/utils/debouncedDocWriter';
import { mergeOutline } from '@/utils/mergeOutline';

import type { StructureWriter } from '@/components/sermon/structureWriter';
import type { SermonOutline } from '@/models/models';

interface SaveHandlers {
  stored: (stored: SermonOutline, continuation: SermonOutline | null) => void;
  failed: (error: unknown, mine: SermonOutline, base: SermonOutline | null) => void;
}
interface OutlineSave {
  outline: SermonOutline;
  base: SermonOutline | null;
  begin: () => SaveHandlers;
}

/** Coalesce board input with the shared scheduler; the engine alone owns durable delivery. */
export class OutlineAutosave {
  private readonly queue: DebouncedDocWriter<OutlineSave>;

  constructor(writer: StructureWriter, private readonly id: string) {
    this.queue = new DebouncedDocWriter(async (_id, request) => {
      const handlers = request.begin();
      let mine = request.outline;
      let base = request.base;
      try {
        const stored = await writer.updateSermonOutline(id, request.outline, request.base) ?? request.outline;
        let continuation: SermonOutline | null = null;
        // Typing during capture is a continuation of this edit, not a competing edit.
        // Rebase it before the shared scheduler can start the next local capture.
        this.queue.rebase(id, waiting => {
          mine = waiting.outline;
          base = request.outline;
          const merged = mergeOutline(base, mine, stored);
          if (merged.collisions.length) throw new OutlineCollisionError(merged.collisions, stored, 0);
          continuation = merged.outline;
          return {...waiting, outline: merged.outline, base: stored};
        });
        handlers.stored(stored, continuation);
      } catch (error) {
        let currentHandlers = handlers;
        this.queue.rebase(id, waiting => {
          mine = waiting.outline;
          // A reopened editor may own the continuation now. Report the refusal to
          // that request, rather than dropping it with the departed request's UI.
          currentHandlers = waiting.begin();
          return waiting;
        });
        // A refusal needs a new choice. It must never become an automatic retry.
        if (isOutlineCollisionError(error)) this.queue.forget(id);
        currentHandlers.failed(error, mine, base);
        throw error;
      }
    }, 120);
  }

  schedule(request: OutlineSave): void { this.queue.schedule(this.id, request); }
  flush(): Promise<void> { return this.queue.flush(this.id); }
}
