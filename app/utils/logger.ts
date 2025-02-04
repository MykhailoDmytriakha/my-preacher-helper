export const log = {
    info: (...args: any[]) => {
      if (process.env.NODE_ENV !== "production") {
        console.info(...args);
      }
    },
    error: (...args: any[]) => console.error(...args),
  };