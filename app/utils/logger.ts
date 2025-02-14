import { toast } from "sonner";

export const log = {
  info: (...args: any[]) => {
    if (process.env.NODE_ENV !== "production") {
      console.info(...args);
    }
  },
  warn: (...args: any[]) => {
    console.warn(...args);
  },
  error: (...args: any[]) => {
    console.error(...args);
    if (typeof window !== "undefined") {
      toast.error(args[0]?.message || "Произошла ошибка");
    }
  },
};
