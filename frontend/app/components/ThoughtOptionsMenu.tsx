import React, { useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { EllipsisVerticalIcon } from "@heroicons/react/24/outline";
import { EditIcon, TrashIcon, CopyIcon, CheckIcon } from "@components/Icons";
import { SPACING } from "@/constants/ui";
import { useClipboard } from "@/hooks/useClipboard";
import { TIMING } from "@/constants/ui";

interface ThoughtOptionsMenuProps {
  thoughtText: string;
  onEdit: () => void;
  onDelete: () => void;
  className?: string;
}

export const ThoughtOptionsMenu: React.FC<ThoughtOptionsMenuProps> = ({
  thoughtText,
  onEdit,
  onDelete,
  className = ''
}) => {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = React.useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  
  const { isCopied, isLoading, copyToClipboard } = useClipboard({
    successDuration: TIMING.COPY_SUCCESS_DURATION,
    onSuccess: () => setIsOpen(false),
    onError: (error: Error) => console.error('Failed to copy thought text:', error)
  });

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    
    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isOpen]);

  const handleCopy = async () => {
    await copyToClipboard(thoughtText);
  };

  const menuItems = [
    {
      id: 'edit',
      label: t('common.edit', 'Edit'),
      icon: EditIcon,
      onClick: () => {
        onEdit();
        setIsOpen(false);
      },
      className: "text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
    },
    {
      id: 'copy',
      label: isCopied ? t('common.copied', 'Copied!') : t('common.copy', 'Copy'),
      icon: isCopied ? CheckIcon : CopyIcon,
      onClick: handleCopy,
      disabled: isLoading,
      className: `${
        isCopied 
          ? 'text-green-600 dark:text-green-400' 
          : 'text-gray-700 dark:text-gray-300'
      } hover:bg-gray-100 dark:hover:bg-gray-700 ${isLoading ? 'opacity-50 cursor-not-allowed' : ''}`
    },
    {
      id: 'delete',
      label: t('common.delete', 'Delete'),
      icon: TrashIcon,
      onClick: () => {
        onDelete();
        setIsOpen(false);
      },
      className: "text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-gray-700"
    }
  ];

  return (
    <div ref={menuRef} className={`relative ${className}`}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="p-1.5 text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-600 rounded-full transition-colors duration-200"
        aria-label={t('thought.optionsMenuLabel', 'Thought options')}
        aria-haspopup="true"
        aria-expanded={isOpen}
      >
        <EllipsisVerticalIcon className={SPACING.ICON_CONTAINER_SIZE} />
      </button>

      {isOpen && (
        <div
          className="absolute right-0 mt-1 w-48 bg-white dark:bg-gray-800 rounded-md shadow-lg py-1 border border-gray-200 dark:border-gray-700 z-20 transform origin-top-right transition-all duration-200 ease-out"
          role="menu"
          aria-orientation="vertical"
          aria-labelledby="options-menu"
        >
          {menuItems.map((item) => {
            const IconComponent = item.icon;
            return (
              <button
                key={item.id}
                onClick={item.onClick}
                disabled={item.disabled}
                className={`w-full flex items-center ${SPACING.MENU_ITEM_PADDING} text-sm ${item.className} transition-colors duration-150`}
                role="menuitem"
              >
                <span className={`inline-flex items-center justify-center ${SPACING.ICON_CONTAINER_SIZE} mr-2 flex-shrink-0`}>
                  <IconComponent className={SPACING.ICON_SIZE} />
                </span>
                {item.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}; 