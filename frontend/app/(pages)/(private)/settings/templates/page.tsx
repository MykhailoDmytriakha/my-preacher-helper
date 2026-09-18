'use client';

import PlanTemplatesSection from '@/components/settings/PlanTemplatesSection';
import { useAuth } from '@/providers/AuthProvider';

export default function PlanTemplatesSettingsPage() {
  const { user } = useAuth();

  return <PlanTemplatesSection user={user} />;
}
