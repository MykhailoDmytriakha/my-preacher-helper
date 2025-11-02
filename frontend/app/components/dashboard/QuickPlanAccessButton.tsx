import { useRouter } from 'next/navigation';
import type { MouseEvent } from 'react';
import { TFunction } from 'i18next';
import { Sermon } from '@/models/models';
import { getSermonPlanAccessRoute, getSermonAccessType, isSermonReadyForPreaching } from '@/utils/sermonPlanAccess';
import { ScrollText } from 'lucide-react';

interface QuickPlanAccessButtonProps {
  sermon: Sermon;
  t: TFunction;
}

/**
 * Quick access buttons for sermon plan/structure/preaching
 * Shows appropriate buttons based on sermon readiness state:
 * - "To structure" (blue) - for new sermons
 * - "To plan" (green) - when plan exists but not ready for preaching
 * - "Preach" (green) - when plan is complete and ready for preaching
 */
export function QuickPlanAccessButton({ sermon, t }: QuickPlanAccessButtonProps) {
  const router = useRouter();
  const accessType = getSermonAccessType(sermon);
  const isReadyForPreaching = isSermonReadyForPreaching(sermon);

  const route = getSermonPlanAccessRoute(sermon.id, sermon);
  const isPlanAccess = accessType === 'plan';

  const handlePlanClick = (event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    router.push(route);
  };

  const handlePreachClick = (event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    window.location.href = `/sermons/${sermon.id}/plan?planView=preaching`;
  };

  return (
    <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 w-full sm:w-auto">
      {/* Primary action: Plan/Structure button */}
      <button
        onClick={handlePlanClick}
        className={`inline-flex items-center justify-center px-3 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
          isPlanAccess
            ? 'bg-green-600 hover:bg-green-700 text-white'
            : 'bg-blue-600 hover:bg-blue-700 text-white'
        }`}
        title={isPlanAccess ? t('dashboard.goToPlan') : t('dashboard.goToStructure')}
      >
        {isPlanAccess ? t('dashboard.toPlan') : t('dashboard.toStructure')}
      </button>

      {/* Secondary action: Preach button - only show when plan is ready */}
      {isReadyForPreaching && (
        <button
          onClick={handlePreachClick}
          className="inline-flex items-center justify-center gap-1 px-3 py-1 text-xs font-medium rounded-md transition-colors bg-green-600 hover:bg-green-700 text-white whitespace-nowrap"
          title={t('plan.preachButton') || 'Preach'}
        >
          <ScrollText className="h-3 w-3 flex-shrink-0" />
          <span>{t('plan.preachButton') || 'Preach'}</span>
        </button>
      )}
    </div>
  );
}
