'use client';

import ModelSelector from '@/components/settings/ModelSelector';
import UsageWidget from '@/components/settings/UsageWidget';
import { useAuth } from '@/providers/AuthProvider';

export default function UsageAndModelsPage() {
  const { user } = useAuth();

  return (
    <div className="space-y-6">
      <UsageWidget user={user} />
      <ModelSelector user={user} />
    </div>
  );
}
