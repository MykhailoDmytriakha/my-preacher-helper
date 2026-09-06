'use client';

import { User } from "firebase/auth";
import Image from "next/image";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import "@locales/i18n";

/**
 * The person's face, wherever it has to appear.
 *
 * There are two of those now — the desktop dropdown trigger and the row that says who is
 * signed in inside the phone menu — and the rules behind the circle are not obvious: fall
 * back to the first letter of the EMAIL when there is no photo, fall back again when the
 * photo fails to load, and render a fixed letter on the server so hydration does not
 * mismatch on a locale the server has not resolved yet. Written twice, those rules drift.
 */
export default function UserAvatar({
  user,
  size = 'md',
}: {
  user: User | null;
  /** `sm` sits inside a menu row, `md` is the tap target in the top bar. */
  size?: 'sm' | 'md';
}) {
  const { t } = useTranslation();
  const [imgError, setImgError] = useState(false);

  // A new photo deserves a fresh attempt; without this a single failed load is permanent.
  useEffect(() => {
    if (user?.photoURL) {
      setImgError(false);
    }
  }, [user?.photoURL]);

  const sizeClass = size === 'sm' ? 'w-8 h-8 text-sm' : 'w-9 h-9';

  return (
    <div className={`${sizeClass} shrink-0 rounded-full bg-gradient-to-r from-blue-600 to-purple-600 flex items-center justify-center text-white`}>
      {user?.photoURL && !imgError ? (
        <Image
          src={user.photoURL}
          alt="Avatar"
          width={40}
          height={40}
          className="w-full h-full rounded-full"
          onError={() => setImgError(true)}
        />
      ) : (
        <span suppressHydrationWarning={true}>
          {typeof window !== 'undefined'
            ? (user?.email?.[0]?.toUpperCase() || t('navigation.guest')[0])
            : 'G' // Always show English letter on server
          }
        </span>
      )}
    </div>
  );
}
