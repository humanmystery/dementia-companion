"use client";

import { useEffect, useSyncExternalStore } from "react";

/** Run an async loader after mount (and whenever it changes identity). */
export function useOnMount(fn: () => unknown) {
  useEffect(() => {
    void Promise.resolve().then(fn);
  }, [fn]);
}

const noopSubscribe = () => () => {};

/** A browser-only value that is `fallback` during server rendering. */
export function useBrowserValue<T>(read: () => T, fallback: T): T {
  return useSyncExternalStore(noopSubscribe, read, () => fallback);
}
