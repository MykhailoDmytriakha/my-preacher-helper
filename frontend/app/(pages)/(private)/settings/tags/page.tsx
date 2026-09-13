'use client';

import TagsSection from '@/components/settings/TagsSection';
import { useAuth } from '@/providers/AuthProvider';

export default function TagsSettingsPage() {
  const { user } = useAuth();

  return <TagsSection user={user} />;
}
