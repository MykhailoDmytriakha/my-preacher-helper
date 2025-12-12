'use client';

import { useEffect, useState } from "react";

import { auth, checkGuestExpiration } from "@services/firebaseAuth.service";

export function GuestBanner() {
  const [isGuest] = useState(false);

  useEffect(() => {
    const user = auth.currentUser;
    if (user?.isAnonymous && !checkGuestExpiration(user)) {
      localStorage.removeItem('guestUser');
      auth.signOut();
    }
  }, []);
  
  if (!isGuest) return null;

  return (
    <div className="bg-yellow-100 dark:bg-yellow-900 border-l-4 border-yellow-500 text-yellow-700 dark:text-yellow-200 p-4 mb-8">
      <div className="flex justify-between items-center">
        <div>
          <p className="font-medium"><strong>Гостевой режим.</strong> Ваши данные будут храниться 5 дней. Для постоянного доступа войдите через Google Account.</p>
        </div>
        <button className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 ml-4">
          Привязать аккаунт
        </button>
      </div>
    </div>
  );
} 