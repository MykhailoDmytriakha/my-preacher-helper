import type { ReactNode } from 'react';

type CareSectionHeaderProps = {
  title: string;
  titleClassName: string;
  icon: ReactNode;
  description: string;
  actions?: ReactNode;
};

/** Keep section names readable while their actions move below them on narrow screens. */
export function CareSectionHeader({
  title,
  titleClassName,
  icon,
  description,
  actions,
}: CareSectionHeaderProps) {
  return (
    <header className="mt-4">
      <div className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center sm:gap-4">
        <h1 className={`flex w-full min-w-0 items-center gap-3 text-2xl font-extrabold tracking-tight sm:w-auto sm:text-3xl ${titleClassName}`}>
          {icon}
          <span className="min-w-0 break-words">{title}</span>
        </h1>
        {actions && (
          <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:shrink-0">
            {actions}
          </div>
        )}
      </div>
      <p className="mt-2 max-w-2xl text-sm leading-relaxed text-gray-600 dark:text-gray-400">
        {description}
      </p>
    </header>
  );
}
