import type { ConfirmKey } from '@/hooks/useConfirm';

/** Deleting a reusable label keeps the authored thoughts and their other labels. */
export function tagDeletionConfirmation(name?: string): { title: ConfirmKey; description: ConfirmKey } {
  return {
    title: name ? { key: 'settings.deleteTagConfirmation.title', values: { name } } : { key: 'settings.deleteTag' },
    description: { key: 'settings.deleteTagConfirmation.description' },
  };
}
