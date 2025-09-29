import { useRouter } from 'next/navigation';
import type { MouseEvent } from 'react';
import { TFunction } from 'i18next';
import { Sermon } from '@/models/models';
import { getSermonPlanAccessRoute, getSermonAccessType } from '@/utils/sermonPlanAccess';

interface QuickPlanAccessButtonProps {
  sermon: Sermon;
  t: TFunction;
}

/**
 * Quick access button for sermon plan/structure
 * Shows "To plan" (green) or "To structure" (blue) based on sermon state
 */
export function QuickPlanAccessButton({ sermon, t }: QuickPlanAccessButtonProps) {
  const router = useRouter();
  const accessType = getSermonAccessType(sermon);
  if (!accessType) return null;

  const route = getSermonPlanAccessRoute(sermon.id, sermon);
  const isPlanAccess = accessType === 'plan';

  const handleClick = (event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    router.push(route);
  };

  return (
    <button
      onClick={handleClick}
      className={`inline-flex items-center px-3 py-1 text-xs font-medium rounded-md transition-colors ${
        isPlanAccess
          ? 'bg-green-600 hover:bg-green-700 text-white'
          : 'bg-blue-600 hover:bg-blue-700 text-white'
      }`}
      title={isPlanAccess ? t('dashboard.goToPlan') : t('dashboard.goToStructure')}
    >
      {isPlanAccess ? t('dashboard.toPlan') : t('dashboard.toStructure')}
    </button>
  );
}
