'use client';

import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';

import PlanTemplatesSection from '@/components/settings/PlanTemplatesSection';
import { useAuth } from '@/providers/AuthProvider';

function TemplatesSettings() {
  const { user } = useAuth();
  const search = useSearchParams();
  return <PlanTemplatesSection user={user} requestedTemplateId={search.get('template')} />;
}

export default function PlanTemplatesSettingsPage() {
  return <Suspense><TemplatesSettings /></Suspense>;
}
