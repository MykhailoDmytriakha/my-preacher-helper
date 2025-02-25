import { format } from 'date-fns';
import { ru } from 'date-fns/locale';

export const formatDate = (dateStr: string) => {
  try {
    return format(new Date(dateStr), 'dd.MM.yyyy, HH:mm', { locale: ru });
  } catch (error) {
    console.error('Error formatting date:', error);
    return 'Invalid date';
  }
};