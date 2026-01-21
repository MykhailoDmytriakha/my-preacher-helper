import { format } from 'date-fns';
import { ru } from 'date-fns/locale';

export const formatDate = (dateStr: string | undefined | null) => {
  try {
    if (!dateStr || dateStr === '') {
      console.warn('formatDate received empty date string:', dateStr);
      return 'No date';
    }
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) {
      console.error('formatDate received invalid date string:', dateStr);
      return 'Invalid date';
    }
    return format(date, 'dd.MM.yyyy, HH:mm', { locale: ru });
  } catch (error) {
    console.error('Error formatting date:', error, 'for input:', dateStr);
    return 'Invalid date';
  }
};