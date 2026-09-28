'use client';

import { createContext, useContext } from 'react';

import type { useDataDocument } from '@/data-engine/react.client';

/** A separate context keeps settings shared even inside another document provider. */
export const UserSettingsEngineContext = createContext<{
  owner: string;
  document: ReturnType<typeof useDataDocument>;
} | null>(null);

export const useSettingsEngine = () => useContext(UserSettingsEngineContext);
