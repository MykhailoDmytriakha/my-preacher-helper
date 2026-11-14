import { object } from './fieldValues';
import { listOwnedDocumentPage } from './legacyBoundary.server';
import { isValidIdentifier } from './protocol';
import { removeTagFromSermons } from './serverEdit.server';

const PAGE_SIZE = 32;
const WORK_SLICE_MS = 2_000;
export const TAG_CLEANUP_PENDING = 'tag-cleanup-pending';

export interface TagCleanupProgress {
  name: string;
  after: string | null;
  completed: boolean;
}

export function readTagCleanup(raw: Record<string, unknown> | undefined, expectedName: unknown): TagCleanupProgress | undefined {
  const progress = raw?.tagCleanup;
  if (progress === undefined) return;
  if (!object(progress) || typeof progress.name !== 'string' || !progress.name || progress.name !== expectedName
    || (progress.after !== null && !isValidIdentifier(progress.after)) || typeof progress.completed !== 'boolean') {
    throw new Error(TAG_CLEANUP_PENDING);
  }
  return { name: progress.name, after: progress.after, completed: progress.completed };
}

/** Checkpoint one page at a time. A lost response or process can only repeat idempotent work. */
export async function resumeTagCleanup(owner: string, progress: TagCleanupProgress,
  save: (expected: TagCleanupProgress, next: TagCleanupProgress) => Promise<TagCleanupProgress>,
  finishAt = performance.now() + WORK_SLICE_MS): Promise<void> {
  const pending = () => new Error(TAG_CLEANUP_PENDING);
  const checkTime = () => { if (performance.now() >= finishAt) throw pending(); };
  while (!progress.completed) {
    checkTime();
    const page = await listOwnedDocumentPage(owner, 'sermons', PAGE_SIZE, progress.after);
    let after = progress.after;
    let nameRestored = false;
    let failure: unknown;
    try {
      const result = await removeTagFromSermons(owner, progress.name, page, {
        beforeDocument: checkTime,
        documentFinished: id => { after = id; },
        nameRestored: () => { nameRestored = true; },
      });
      if (result.failed) failure = pending();
    } catch (error) {
      failure = error;
    }
    const expected = progress;
    const completed = nameRestored || (!failure && page.length < PAGE_SIZE);
    if (after !== expected.after || completed) {
      progress = await save(expected, { name: expected.name, after, completed });
    }
    if (failure && !progress.completed) throw failure;
  }
}
