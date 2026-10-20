'use client';

import { createContext, useContext } from 'react';

/** Only the shared banner owner may say that the outage is already explained on this screen. */
export const ServerUnavailableNoticeContext = createContext(false);
export const useServerUnavailableNotice = () => useContext(ServerUnavailableNoticeContext);
