export const formatDate = (dateStr: string, locale = "ru-RU") => {
    return new Date(dateStr).toLocaleString(locale, {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  };