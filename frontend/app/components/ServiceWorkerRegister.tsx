"use client";

import { useEffect } from "react";

const SERVICE_WORKER_URL = "/sw.js";

export function ServiceWorkerRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator)) return;

    const register = async () => {
      try {
        await navigator.serviceWorker.register(SERVICE_WORKER_URL, { scope: "/" });
      } catch (error) {
        console.error("ServiceWorker registration failed:", error);
      }
    };

    if (document.readyState === "complete") {
      void register();
      return undefined;
    }

    window.addEventListener("load", register, { once: true });
    return () => window.removeEventListener("load", register);
  }, []);

  return null;
}
