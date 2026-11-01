'use client';

import AudioGenerationToggle from '@/components/settings/AudioGenerationToggle';
import DebugModeToggle from '@/components/settings/DebugModeToggle';
import ReferralCard from '@/components/settings/ReferralCard';
import ShowVersionToggle from '@/components/settings/ShowVersionToggle';
import UserSettingsSection from '@/components/settings/UserSettingsSection';
import { useAuth } from '@/providers/AuthProvider';

export default function UserSettingsPage() {
  const { user } = useAuth();

  return (
    <div className="space-y-6">
      <ReferralCard user={user} />
      <UserSettingsSection user={user} />
      <div className="rounded-lg bg-white shadow dark:bg-gray-800">
        <AudioGenerationToggle />
        <DebugModeToggle />
        <ShowVersionToggle />
      </div>
    </div>
  );
}
