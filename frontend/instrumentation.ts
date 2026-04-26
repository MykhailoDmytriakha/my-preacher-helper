import { installServerOutputLogger } from './app/utils/serverOutputLogger';

export async function register() {
  if (typeof window !== 'undefined') return;

  installServerOutputLogger();
}
