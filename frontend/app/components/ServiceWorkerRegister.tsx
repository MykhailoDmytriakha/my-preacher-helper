"use client";

import { useEffect } from "react";

import { debugLog } from "@/utils/debugMode";

const SERVICE_WORKER_URL = "/sw.js";

export function ServiceWorkerRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator)) return;

    const register = async () => {
      try {
        debugLog("ServiceWorker: registering", { url: SERVICE_WORKER_URL });
        const registration = await navigator.serviceWorker.register(SERVICE_WORKER_URL, { scope: "/" });
        debugLog("ServiceWorker: registered", {
          scope: registration.scope,
          active: Boolean(registration.active),
        });

        registration.addEventListener("updatefound", () => {
          const installing = registration.installing;
          debugLog("ServiceWorker: update found", { hasInstalling: Boolean(installing) });
          if (installing) {
            installing.addEventListener("statechange", () => {
              debugLog("ServiceWorker: state changed", { state: installing.state });
            });
          }
        });

        navigator.serviceWorker.ready.then((readyRegistration) => {
          debugLog("ServiceWorker: ready", {
            scope: readyRegistration.scope,
            active: Boolean(readyRegistration.active),
          });
        });
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

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator)) return;

    const handleControllerChange = () => {
      debugLog("ServiceWorker: controller changed", {
        controller: Boolean(navigator.serviceWorker.controller),
      });
    };

    navigator.serviceWorker.addEventListener("controllerchange", handleControllerChange);
    return () => {
      navigator.serviceWorker.removeEventListener("controllerchange", handleControllerChange);
    };
  }, []);

  return null;
}
